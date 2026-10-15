import { scenarioAssertionResults } from './scenario-agent-plan';
import type { ScenarioRunState } from './scenario-contract';
import {
  type ScenarioReportAnalysis,
  scenarioExecutionLabel,
} from './scenario-report';
import {
  scenarioReportDescription,
  scenarioReportDetail,
} from './scenario-report-language';

export function escapeReportHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );
}

export function renderScenarioHtmlConclusion(
  run: ScenarioRunState,
  analysis?: ScenarioReportAnalysis,
  omittedSteps = 0,
) {
  const e = escapeReportHtml;
  const tr = (cn: string, en: string) => (run.language === 'en' ? en : cn);
  const statuses: Record<string, string> = {
    passed: tr('通过', 'Passed'),
    failed: tr('失败', 'Failed'),
    blocked: tr('阻塞', 'Blocked'),
    pending: tr('未执行', 'Not executed'),
    stopped: tr('已停止', 'Stopped'),
    skipped: tr('已跳过', 'Skipped'),
    running: tr('执行中', 'Running'),
    waiting: tr('等待', 'Waiting'),
  };
  const steps = run.scripts.flatMap((s) => s.steps || []);
  const checks = steps.flatMap(scenarioAssertionResults);
  const counts = [
    'passed',
    'failed',
    'blocked',
    'pending',
    'stopped',
    'skipped',
  ];
  const rows = run.scripts
    .map(
      (
        s,
        si,
      ) => `<details${s.status === 'passed' ? '' : ' open'}><summary>S${si + 1} · ${e(s.name)} <span class="status ${e(s.status)}">${e(statuses[s.status])}</span></summary>
    ${s.continuation?.reason ? `<p>${e(s.continuation.reason)}</p>` : ''}
    ${s.error ? `<p class="notice">${e(s.error)}</p>` : ''}
    <ol>${(s.steps || [])
      .map(
        (
          step,
          i,
        ) => `<li><strong>${e(scenarioReportDescription(step.description, run.language))}</strong> <span class="status ${e(step.status)}">${e(statuses[step.status])}</span>
      ${(run.evidenceLinks || [])
        .filter(
          (link) => link.scriptIndex === si && link.stepIds.includes(step.id),
        )
        .slice(-1)
        .map(
          (link) =>
            `<button type="button" class="evidence-link" data-task-id="${e(link.taskId)}">${link.stepIds.length > 1 ? tr('查看操作片段结果', 'View operation block outcome') : tr('查看对应画面', 'View evidence')} · ${e(link.label)}</button>`,
        )
        .join('')}
      ${step.type === 'agent-assertion' ? `<p>${tr('断言', 'Assertion')}: ${e(step.instruction || step.description)}</p>` : ''}
      ${step.continuedAfterFailure ? `<p>${tr('已按要求记录失败并继续执行。', 'Failure recorded; execution continued as requested.')}</p>` : ''}
      ${step.agentTask ? `<ol>${step.agentTask.actions.map((result) => `<li>${e(result.action.type === 'wait' ? tr(`等待 ${result.action.milliseconds / 1000} 秒`, `Wait ${result.action.milliseconds / 1000} s`) : `${result.action.type === 'assertion' ? tr('断言', 'Assertion') : tr('操作', 'Operation')}: ${result.action.instruction}`)} <span class="status ${e(result.status)}">${e(statuses[result.status])}</span>${result.detail ? `<p>${e(result.detail)}</p>` : ''}</li>`).join('')}</ol>` : ''}
      ${step.error || step.detail ? `<p>${e(scenarioReportDetail(step.error || step.detail || '', run.language))}</p>` : ''}
      ${step.recovery ? `<p>Agent · ${e(step.recovery.status === 'recovered' ? tr('接管后通过', 'Recovered') : tr('接管未成功', 'Recovery did not succeed'))}</p><p>${e(step.recovery.originalError)}</p><p>${e(step.recovery.reason)}</p>` : ''}
      ${
        analysis?.findings
          .filter((f) => f.scriptIndex === si && f.stepIndex === i)
          .map(
            (f) =>
              `<p>${tr('影响', 'Impact')}${f.certainty === 'needs-review' ? tr('（待复核）', ' (needs review)') : ''}: ${e(f.impact)}</p><p>${tr('建议', 'Recommendation')}: ${e(f.recommendation)}</p>`,
          )
          .join('') || ''
      }
    </li>`,
      )
      .join('')}</ol></details>`,
    )
    .join('');
  const title =
    (run.scope === 'script' ? run.scripts[0]?.name : run.scenarioName) ||
    run.scenarioId;
  return `<h1>${e(title)}</h1><h2>${e(scenarioExecutionLabel(run))}</h2>
    <p>${e(analysis?.overview || tr('AI 分析未生成，以下为实际执行记录。', 'AI analysis unavailable. Actual execution records follow.'))}</p>
    ${!checks.length ? `<p class="notice">${tr('未设置检查点，业务正确性未验证。', 'No checkpoints were defined; business correctness was not verified.')}</p>` : ''}
    <p class="muted">${run.startedAt ? e(new Date(run.startedAt).toISOString()) : ''} · ${tr('耗时', 'Duration')} ${run.startedAt && run.finishedAt ? ((run.finishedAt - run.startedAt) / 1000).toFixed(1) : '—'} s</p>
    <table><thead><tr><th>${tr('统计对象', 'Group')}</th><th>${tr('总数', 'Total')}</th>${counts.map((s) => `<th>${e(statuses[s])}</th>`).join('')}</tr></thead><tbody>${[
      [tr('脚本', 'Scripts'), run.scripts],
      [tr('步骤', 'Steps'), steps],
      [tr('检查点', 'Checkpoints'), checks],
    ]
      .map(([label, items]) => {
        const list = items as Array<{ status: string }>;
        return `<tr><td>${label}</td><td>${list.length}</td>${counts.map((s) => `<td>${list.filter((i) => i.status === s).length}</td>`).join('')}</tr>`;
      })
      .join('')}</tbody></table>
    <h2>${tr('执行明细', 'Execution details')}</h2>${rows}
    ${
      analysis?.findings
        .filter((f) => f.stepIndex === null)
        .map(
          (f) =>
            `<p>S${f.scriptIndex + 1}: ${e(f.impact)} — ${e(f.recommendation)}</p>`,
        )
        .join('') || ''
    }
    ${analysis?.limitations.length || omittedSteps ? `<h2>${tr('未验证范围', 'Verification limits')}</h2><ul>${analysis?.limitations.map((s) => `<li>${e(s)}</li>`).join('') || ''}${omittedSteps ? `<li>${omittedSteps} ${tr('个步骤未纳入 AI 分析，执行记录仍完整保留。', 'steps omitted from AI analysis; execution records are retained.')}</li>` : ''}</ul>` : ''}
    <p class="muted">${tr('执行编号', 'Run ID')}: ${e(run.id)} · ${tr('结论待人工确认。', 'Subject to human review.')}</p>`;
}

/** One viewer owns the conclusion, steps and original replay. Only inert dump
 * attachments are copied from an older evidence file; its UI bundle is replaced
 * by the current template without changing any execution evidence. */
export function composeScenarioHtml(
  run: ScenarioRunState,
  officialHtml?: string,
  reportTemplate?: string,
) {
  const e = escapeReportHtml;
  const tr = (cn: string, en: string) => (run.language === 'en' ? en : cn);
  if (reportTemplate || officialHtml?.includes('midscene_scenario_dump')) {
    const attachments = reportTemplate
      ? Array.from(
          (officialHtml || '').matchAll(
            /<script\b([^>]*)>[\s\S]*?<\/script>/gi,
          ),
        )
          .filter((match) =>
            /(?:^|\s)type=["'](?:midscene_web_dump|midscene-image|midscene-animated-webp(?:-manifest)?)["']/i.test(
              match[1],
            ),
          )
          .map((match) => match[0])
          .join('\n')
      : '';
    const payload = JSON.stringify(run).replace(/</g, '\\u003c');
    const source = reportTemplate || officialHtml!;
    return source
      .replace(
        /<html([^>]*)>/i,
        `<html$1 lang="${run.language === 'en' ? 'en' : 'zh-CN'}">`,
      )
      .replace(
        /<title>[\s\S]*?<\/title>/i,
        `<title>${e(run.scenarioName || tr('测试报告', 'Test report'))}</title>`,
      )
      .replace(/<head([^>]*)>/i, `<head$1>${reportStorageBootstrap}`)
      .replace(
        /<\/body>/i,
        `${attachments}<script type="midscene_scenario_dump">${payload}</script></body>`,
      );
  }
  const conclusion = run.summary?.text
    ? run.summary.format === 'html'
      ? run.summary.text
      : `<pre>${e(run.summary.text)}</pre>`
    : renderScenarioHtmlConclusion(
        run,
        run.summary?.analysis,
        run.summary?.omittedSteps,
      );
  // The upstream viewer persists display preferences in localStorage. An
  // opaque sandbox deliberately cannot access Studio storage. Give this
  // isolated viewer an ephemeral Storage implementation, never same-origin
  // privileges or a bridge into the host application.
  const viewer = officialHtml?.replace(
    /<head([^>]*)>/i,
    `<head$1><script>
    document.documentElement.lang = '${run.language === 'en' ? 'en' : 'zh-CN'}';
    for (const name of ['localStorage','sessionStorage']) {
      try { window[name].getItem('__report_storage_probe__'); }
      catch { const entries = new Map(); Object.defineProperty(window, name, { value: {
        getItem: key => entries.get(String(key)) ?? null,
        setItem: (key,value) => entries.set(String(key),String(value)),
        removeItem: key => entries.delete(String(key)), clear: () => entries.clear(),
        key: index => Array.from(entries.keys())[index] ?? null,
        get length() { return entries.size; }
      }}); }
    }
    </script>`,
  );
  return `<!doctype html><html lang="${run.language === 'en' ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(run.scenarioName || tr('测试报告', 'Test report'))}</title><style>
    *{box-sizing:border-box}body{margin:0;background:#fff;color:#202939;font:14px/1.65 system-ui,"Microsoft YaHei",sans-serif}nav{position:sticky;top:0;z-index:1;display:flex;gap:6px;padding:12px 20px;border-bottom:1px solid #e5e7eb;background:#fff}nav label{cursor:pointer;padding:6px 18px;border-radius:8px;color:#536076}body>input{position:absolute;opacity:0;pointer-events:none}#conclusion:checked~nav label[for=conclusion],#evidence:checked~nav label[for=evidence]{background:#eaf2ff;color:#1677ff}#conclusion:focus-visible~nav label[for=conclusion],#evidence:focus-visible~nav label[for=evidence]{outline:2px solid #1677ff}main{padding:20px 26px}h1{font-size:20px;margin:0 0 12px}h2{font-size:16px;margin:20px 0 10px}p{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:18px 0}td,th{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left}th{background:#f8fafc}details{border:1px solid #e5e7eb;border-radius:10px;margin:12px 0;padding:12px}summary{cursor:pointer;font-weight:600}li{padding:8px 0}li p{margin:6px 0}.status{font-size:12px;font-weight:400;margin-left:8px;color:#64748b}.passed{color:#15803d}.failed,.blocked{color:#b91c1c}.notice{padding:10px;background:#fff7ed;border-radius:8px}.muted{color:#64748b;font-size:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}#process{display:none;padding:0}#evidence:checked~#process{display:block}#evidence:checked~#overview{display:none}iframe{display:block;border:0;width:100%;height:calc(100vh - 65px)}
    .evidence-link{display:block;border:0;background:#eaf2ff;color:#1677ff;border-radius:6px;padding:5px 10px;margin:6px 0;cursor:pointer;text-align:left}
    </style></head><body><input type="radio" id="conclusion" name="view" checked><input type="radio" id="evidence" name="view"><nav><label for="conclusion">${tr('测试结论', 'Test conclusion')}</label><label for="evidence">${tr('执行过程', 'Execution process')}</label></nav><main id="overview">${run.evidenceError ? `<p class="notice">${e(run.evidenceError)}</p>` : ''}${conclusion}</main><main id="process">${viewer ? `<iframe title="${tr('执行过程', 'Execution process')}" sandbox="allow-scripts" allow="fullscreen *" allowfullscreen srcdoc="${e(viewer)}"></iframe>` : `<p class="notice">${tr('此记录没有可用的过程截图，执行结果见测试结论。', 'No process screenshots are available for this record. See the test conclusion.')}</p>`}</main><script>
    let selectedTask;
    const sendSelection = () => { const frame = document.querySelector('iframe'); if (frame && selectedTask) frame.contentWindow.postMessage({type:'midscene-select-task',taskId:selectedTask},'*'); };
    document.addEventListener('click', event => { const button = event.target.closest('[data-task-id]'); if (!button) return; selectedTask = button.dataset.taskId; document.getElementById('evidence').checked = true; sendSelection(); });
    window.addEventListener('message', event => { if(event.source === document.querySelector('iframe')?.contentWindow && event.data?.type === 'midscene-report-ready') sendSelection(); });
    </script></body></html>`;
}

// Studio opens the downloaded viewer in an opaque sandbox. Give its existing
// preferences an ephemeral Storage implementation; never grant same-origin.
const reportStorageBootstrap = `<script>
for (const name of ['localStorage','sessionStorage']) {
  try { window[name].getItem('__report_storage_probe__'); }
  catch { const entries = new Map(); Object.defineProperty(window, name, { value: {
    getItem: key => entries.get(String(key)) ?? null,
    setItem: (key,value) => entries.set(String(key),String(value)),
    removeItem: key => entries.delete(String(key)), clear: () => entries.clear(),
    key: index => Array.from(entries.keys())[index] ?? null,
    get length() { return entries.size; }
  }}); }
}
</script>`;
