import type { ScenarioRunState, ScenarioStepResult } from './scenario-contract';

export interface ScenarioReportAnalysis {
  overview: string;
  findings: Array<{
    scriptIndex: number;
    stepIndex: number | null;
    category:
      | 'assertion'
      | 'automation'
      | 'environment'
      | 'prerequisite'
      | 'uncertain';
    certainty: 'confirmed' | 'needs-review';
    evidence: string;
    impact: string;
    recommendation: string;
  }>;
  limitations: string[];
}

/** Plain text fields must not become Markdown structure, links or HTML. */
export function reportText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&');
}

export function scenarioExecutionLabel(run: ScenarioRunState): string {
  const zh = run.language !== 'en';
  if (run.status === 'blocked') return zh ? '执行阻塞' : 'Execution blocked';
  if (run.status === 'stopped') return zh ? '已停止' : 'Stopped';
  if (run.status === 'completed')
    return zh ? '执行完成' : 'Execution completed';
  if (
    run.status === 'failed' &&
    run.scripts.length &&
    run.scripts.every((s) => ['passed', 'failed', 'skipped'].includes(s.status))
  )
    return zh ? '执行完成 · 存在失败项' : 'Execution completed · Some failures';
  return zh ? '执行中断' : 'Execution interrupted';
}

export function reportStepIsAbnormal(step: ScenarioStepResult) {
  return ['failed', 'blocked'].includes(step.status) || Boolean(step.recovery);
}

export function renderScenarioReport(
  run: ScenarioRunState,
  analysis?: ScenarioReportAnalysis,
  omittedSteps = 0,
): string {
  const tr = (cn: string, en: string) => (run.language !== 'en' ? cn : en);
  const clean = reportText;
  const brief = (value: string) =>
    clean(value.length > 400 ? `${value.slice(0, 400)}…` : value);
  const statusNames = {
    passed: tr('通过', 'Passed'),
    failed: tr('失败', 'Failed'),
    blocked: tr('阻塞', 'Blocked'),
    pending: tr('未执行', 'Not executed'),
    stopped: tr('已停止', 'Stopped'),
    skipped: tr('已跳过', 'Skipped'),
    running: tr('未完成', 'Unfinished'),
    waiting: tr('未执行', 'Not executed'),
  };
  const states = [
    'passed',
    'failed',
    'blocked',
    'pending',
    'stopped',
    'skipped',
  ] as const;
  const steps = run.scripts.flatMap((s) => s.steps || []);
  const checks = steps.filter((s) => s.type === 'agent-assertion');
  const stats = (items: Array<{ status: string }>) =>
    states.map((status) => items.filter((s) => s.status === status).length);
  const rows = (items: unknown[][]) =>
    items.map((row) => `| ${row.map(clean).join(' | ')} |`).join('\n');
  const title =
    run.scope === 'script' ? run.scripts[0]?.name : run.scenarioName;
  const lines = [
    `# ${tr('测试执行报告', 'Test execution report')} · ${clean(title || run.scenarioId)}`,
    '',
    `## 1. ${tr('测试结论', 'Test conclusion')}`,
    '',
    `**${scenarioExecutionLabel(run)}**`,
    '',
    analysis
      ? clean(analysis.overview)
      : tr(
          'AI 分析未生成，以下为基础报告。',
          'AI analysis is unavailable. Basic execution report follows.',
        ),
    '',
  ];
  if (!checks.length)
    lines.push(
      tr(
        '未设置检查点，业务正确性未验证。',
        'No checkpoints were defined; business correctness was not verified.',
      ),
      '',
    );
  lines.push(`## 2. ${tr('执行概况', 'Execution overview')}`, '');
  const date = run.startedAt
    ? new Date(run.startedAt).toISOString()
    : tr('未记录时间', 'Time not recorded');
  const duration =
    run.startedAt && run.finishedAt
      ? `${Math.max(0, (run.finishedAt - run.startedAt) / 1000).toFixed(1)} s`
      : '—';
  lines.push(
    `${clean(date)} · ${tr('耗时', 'Duration')} ${clean(duration)} · ${run.sessionMode === 'fresh' ? (run.platformId === 'android' ? tr('重启应用', 'Restart application') : tr('全新会话', 'Fresh session')) : tr('沿用当前会话', 'Current session')}`,
    '',
  );
  lines.push(
    rows([
      [
        tr('统计对象', 'Group'),
        tr('总数', 'Total'),
        ...states.map((s) => statusNames[s]),
      ],
    ]),
    `| ${Array(states.length + 2)
      .fill('---')
      .join(' | ')} |`,
    rows([
      [tr('脚本', 'Scripts'), run.scripts.length, ...stats(run.scripts)],
      [tr('步骤', 'Steps'), steps.length, ...stats(steps)],
      [tr('检查点', 'Checkpoints'), checks.length, ...stats(checks)],
    ]),
    '',
    `## 3. ${tr('问题与影响', 'Findings and impact')}`,
    '',
  );
  const findingAt = (scriptIndex: number, stepIndex: number | null) =>
    analysis?.findings.find(
      (f) => f.scriptIndex === scriptIndex && f.stepIndex === stepIndex,
    );
  const impact = (finding?: ScenarioReportAnalysis['findings'][number]) => {
    if (finding)
      lines.push(
        `- ${tr('影响', 'Impact')}${finding.certainty === 'needs-review' ? tr('（待复核）', ' (needs review)') : ''}: ${clean(finding.impact)}`,
      );
  };
  let issues = 0;
  run.scripts.forEach((script, si) => {
    const abnormal = (script.steps || [])
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => reportStepIsAbnormal(step));
    if (
      (script.error && !abnormal.length) ||
      script.continuation?.status === 'blocked'
    ) {
      issues++;
      lines.push(
        `### S${si + 1}. ${clean(script.name)} · ${statusNames[script.status]}`,
        '',
        `- ${tr('原因', 'Reason')}: ${brief(script.continuation?.reason || script.error || '')}`,
      );
      impact(findingAt(si, null));
      lines.push('');
    }
    abnormal.forEach(({ step, index }) => {
      issues++;
      lines.push(
        `### S${si + 1} / ${index + 1}. ${clean(script.name)} · ${clean(step.description)}`,
        '',
        `- ${tr('结果', 'Result')}: ${statusNames[step.status]}`,
      );
      if (
        step.type === 'agent-assertion' &&
        step.instruction &&
        step.instruction !== step.description
      )
        lines.push(`- ${tr('预期', 'Expected')}: ${brief(step.instruction)}`);
      const raw = step.error || step.detail || step.recovery?.originalError;
      if (raw) lines.push(`- ${tr('实际', 'Observed')}: ${brief(raw)}`);
      if (step.recovery) {
        const recovered = step.recovery.status === 'recovered';
        lines.push(
          `- Agent: ${recovered ? tr('接管后通过', 'Passed after recovery') : tr('接管未成功', 'Recovery did not succeed')}${step.recovery.reason && step.recovery.reason !== raw ? `；${brief(step.recovery.reason)}` : ''}`,
        );
      }
      impact(findingAt(si, index));
      lines.push('');
    });
  });
  if (!issues) lines.push(tr('未记录异常。', 'No incidents recorded.'), '');
  lines.push(`## 4. ${tr('处理建议', 'Next actions')}`, '');
  const recommendations = new Map<string, string[]>();
  analysis?.findings.forEach((f) => {
    const key = f.recommendation.trim();
    recommendations.set(key, [
      ...(recommendations.get(key) || []),
      `S${f.scriptIndex + 1}${f.stepIndex === null ? '' : ` / ${f.stepIndex + 1}`}`,
    ]);
  });
  if (recommendations.size)
    for (const [recommendation, refs] of recommendations)
      lines.push(`- ${refs.join('、')}: ${clean(recommendation)}`);
  else
    lines.push(
      issues
        ? tr(
            '请人工复核上述异常，暂无 AI 处理建议。',
            'Review the incidents manually; AI recommendations are unavailable.',
          )
        : tr('无需专项处理。', 'No incident-specific action needed.'),
    );
  const limitations = [
    ...new Set(analysis?.limitations.map((x) => x.trim()) || []),
  ];
  if (limitations.length || omittedSteps)
    lines.push(
      '',
      `**${tr('未验证范围', 'Verification limits')}**`,
      '',
      ...limitations.map((x) => `- ${clean(x)}`),
      ...(omittedSteps
        ? [
            `- ${tr(`AI 分析未包含 ${omittedSteps} 个步骤；统计及异常记录保留完整结果。`, `${omittedSteps} steps were omitted from AI analysis; statistics and incidents retain the full result.`)}`,
          ]
        : []),
    );
  lines.push(
    '',
    `${tr('执行编号', 'Run ID')}: ${clean(run.id)} · ${tr('结论待人工确认。', 'Subject to human review.')}`,
    '',
  );
  return lines.join('\n');
}
