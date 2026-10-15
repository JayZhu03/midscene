import {
  ArrowLeftOutlined,
  CheckOutlined,
  CloseOutlined,
  ExpandOutlined,
  FileTextOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  RightOutlined,
} from '@ant-design/icons';
import {
  type ScenarioRunState,
  type ScenarioStepResult,
  scenarioAssertionResults,
  scenarioExecutionLabel,
  scenarioReportDescription,
  scenarioReportDetail,
  scenarioReportIssues,
  scenarioReportOverview,
} from '@midscene/playground';
import {
  Player,
  generateAnimationScripts,
  globalThemeConfig,
} from '@midscene/visualizer';
import { App as AntdApp, ConfigProvider, theme } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlaywrightTasks } from '../../types';
import {
  createScenarioEvidenceResolver,
  scenarioDisplayStepGroups,
  scenarioEvidenceDimensions,
  scenarioEvidenceFor,
  scenarioFrameIndex,
  scenarioGroupFrameIndex,
  scenarioOperationDetails,
  scenarioStepForTask,
  scenarioStepLabel,
} from './model';
import './index.less';

type Translate = (zh: string, en: string) => string;
const statusText = (status: string, tr: Translate) =>
  ({
    passed: tr('通过', 'Passed'),
    failed: tr('失败', 'Failed'),
    blocked: tr('阻塞', 'Blocked'),
    skipped: tr('已跳过', 'Skipped'),
    stopped: tr('已停止', 'Stopped'),
    pending: tr('未执行', 'Not executed'),
    running: tr('执行中', 'Running'),
    waiting: tr('等待继续', 'Waiting'),
    recovered: tr('接管恢复', 'Recovered'),
  })[status] || status;
const duration = (start?: number, end?: number) =>
  start !== undefined && end !== undefined
    ? `${Math.max(0, (end - start) / 1000).toFixed(1)} s`
    : '—';
const date = (value: number | undefined, language?: string) =>
  value === undefined
    ? '—'
    : new Date(value).toLocaleString(language === 'en' ? 'en-GB' : 'zh-CN', {
        hour12: false,
      });

function Status({ value, tr }: { value: string; tr: Translate }) {
  return <span className={`sr-status ${value}`}>{statusText(value, tr)}</span>;
}

export default function ScenarioReport({
  run,
  reports,
}: { run: ScenarioRunState; reports: PlaywrightTasks[] }) {
  const tr: Translate = (zh, en) => (run.language === 'en' ? en : zh);
  const stats = useMemo(() => scenarioReportOverview(run), [run]);
  const issues = useMemo(() => scenarioReportIssues(run), [run]);
  const failures = issues.filter((issue) => issue.kind !== 'recovered');
  const recoveries = issues.filter((issue) => issue.kind === 'recovered');
  const resolve = useMemo(
    () => createScenarioEvidenceResolver(reports),
    [reports],
  );
  const [selection, setSelection] = useState<{
    script: number;
    step: number;
  }>();
  const main = useRef<HTMLElement>(null);
  const returnState = useRef({ top: 0, script: 0 });
  const analysis = run.summary?.analysis;
  const title =
    (run.scope === 'script' ? run.scripts[0]?.name : run.scenarioName) ||
    run.scenarioId;
  const open = (script: number, step = 0) => {
    returnState.current = { top: main.current?.scrollTop || 0, script };
    setSelection({ script, step });
    main.current?.scrollTo(0, 0);
  };
  const back = () => {
    setSelection(undefined);
    requestAnimationFrame(() => {
      main.current?.scrollTo(0, returnState.current.top);
      main.current
        ?.querySelector<HTMLButtonElement>(
          `[data-script-index="${returnState.current.script}"]`,
        )
        ?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light');
  }, []);
  return (
    <ConfigProvider
      theme={{ ...globalThemeConfig(), algorithm: theme.defaultAlgorithm }}
    >
      <AntdApp component={false}>
        <div className="scenario-report">
          <header className="sr-topbar">
            <FileTextOutlined />
            <strong>{tr('测试报告', 'Test report')}</strong>
            <span>
              {run.platformId === 'android'
                ? tr('安卓测试', 'Android test')
                : tr('网页测试', 'Web test')}
            </span>
          </header>
          <main className="sr-main" ref={main}>
            {selection ? (
              <ScriptDetail
                key={selection.script}
                run={run}
                scriptIndex={selection.script}
                initialStep={selection.step}
                resolve={resolve}
                tr={tr}
                onBack={back}
              />
            ) : (
              <div className="sr-overview">
                <div className="sr-eyebrow">
                  {run.scope === 'script'
                    ? tr('单独执行', 'Script execution')
                    : tr('场景执行', 'Scenario execution')}
                </div>
                <h1>{title}</h1>
                <div className="sr-meta">
                  <span>{date(run.startedAt, run.language)}</span>
                  <span>
                    {tr('耗时', 'Duration')}{' '}
                    {duration(run.startedAt, run.finishedAt)}
                  </span>
                  <span>
                    {run.sessionMode === 'fresh'
                      ? tr('全新会话', 'Fresh session')
                      : tr('当前会话', 'Current session')}
                  </span>
                </div>
                <section className="sr-outcome">
                  <h2>
                    <span className={`sr-outcome-mark ${run.status}`}>
                      {run.status === 'completed' ? (
                        <CheckOutlined />
                      ) : (
                        <CloseOutlined />
                      )}
                    </span>
                    {scenarioExecutionLabel(run)}
                  </h2>
                  {analysis?.overview ? (
                    <p>{analysis.overview}</p>
                  ) : run.summary?.status !== 'completed' ? (
                    <p>
                      {tr(
                        'AI 分析未生成，以下为实际执行记录。',
                        'AI analysis unavailable. Actual execution records follow.',
                      )}
                    </p>
                  ) : null}
                  <div className="sr-stats">
                    <span>
                      {tr('脚本已执行', 'Scripts executed')}{' '}
                      <b>
                        {stats.finishedScripts}/{stats.scripts}
                      </b>
                    </span>
                    {stats.checks > 0 && (
                      <span>
                        {tr('检查通过', 'Checks passed')}{' '}
                        <b>{stats.passedChecks}</b>
                        {stats.failedChecks > 0 && (
                          <span className="sr-red">
                            {tr('不符', 'Mismatched')}{' '}
                            <b>{stats.failedChecks}</b>
                          </span>
                        )}
                        {stats.unverifiedChecks > 0 && (
                          <span>
                            {tr('未验证', 'Unverified')}{' '}
                            <b>{stats.unverifiedChecks}</b>
                          </span>
                        )}
                      </span>
                    )}
                    {stats.recovered > 0 && (
                      <span>
                        {tr('Agent 接管恢复', 'Agent recoveries')}{' '}
                        <b>{stats.recovered}</b>
                      </span>
                    )}
                  </div>
                  {!stats.checks && (
                    <p className="sr-scope-note">
                      {tr(
                        '未设置检查点，业务正确性未验证。',
                        'No checkpoints were defined; business correctness was not verified.',
                      )}
                    </p>
                  )}
                </section>
                {failures.length > 0 && (
                  <section className="sr-section">
                    <h2>{tr('需要关注', 'Needs attention')}</h2>
                    <div className="sr-issues">
                      {failures.map((issue) => (
                        <button
                          type="button"
                          className="sr-issue"
                          key={`${issue.scriptIndex}/${issue.stepIndex}`}
                          onClick={() =>
                            open(issue.scriptIndex, issue.stepIndex ?? 0)
                          }
                        >
                          <span className={`sr-issue-symbol ${issue.kind}`}>
                            {issue.kind === 'recovered' ? '↻' : '!'}
                          </span>
                          <span className="sr-issue-copy">
                            <strong className="sr-issue-title">
                              {issue.stepIndex === null
                                ? run.scripts[issue.scriptIndex].name
                                : scenarioStepLabel(
                                    run.scripts[issue.scriptIndex].steps![
                                      issue.stepIndex
                                    ],
                                    run.language,
                                  ).title}
                            </strong>
                            <span className="sr-issue-evidence">
                              {issue.evidence}
                            </span>
                            <small>
                              {run.scripts[issue.scriptIndex].name}
                              {issue.stepIndex !== null &&
                                ` · ${tr('第', 'Step')} ${issue.stepIndex + 1} ${tr('步', '')}`}{' '}
                              ·{' '}
                              {issue.kind === 'recovered'
                                ? tr('接管恢复', 'Recovered')
                                : issue.kind === 'blocked'
                                  ? tr('执行阻塞', 'Blocked')
                                  : issue.kind === 'recovery-failed'
                                    ? tr('接管未解决', 'Recovery unsuccessful')
                                    : tr(
                                        '检查或操作失败',
                                        'Check or operation failed',
                                      )}
                            </small>
                          </span>
                          <span className="sr-link">
                            {tr('查看', 'View')} <RightOutlined />
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {recoveries.length > 0 && (
                  <details className="sr-recoveries">
                    <summary>
                      {tr(
                        `Agent 已恢复 ${recoveries.length} 项操作`,
                        `Agent recovered ${recoveries.length} actions`,
                      )}
                    </summary>
                    {recoveries.map((issue) => (
                      <button
                        type="button"
                        className="sr-issue"
                        key={`${issue.scriptIndex}/${issue.stepIndex}`}
                        onClick={() =>
                          open(issue.scriptIndex, issue.stepIndex ?? 0)
                        }
                      >
                        <span className="sr-issue-symbol recovered">↻</span>
                        <span className="sr-issue-copy">
                          <strong>
                            {
                              scenarioStepLabel(
                                run.scripts[issue.scriptIndex].steps![
                                  issue.stepIndex!
                                ],
                                run.language,
                              ).title
                            }
                          </strong>
                          <span className="sr-issue-evidence">
                            {issue.evidence}
                          </span>
                        </span>
                        <RightOutlined className="sr-chevron" />
                      </button>
                    ))}
                  </details>
                )}
                <section className="sr-section">
                  <h2>{tr('执行流程', 'Execution flow')}</h2>
                  <ol className="sr-scripts">
                    {run.scripts.map((script, scriptIndex) => {
                      const recovered =
                        script.steps?.filter(
                          (step) => step.recovery?.status === 'recovered',
                        ).length || 0;
                      const checks = (script.steps || []).flatMap(
                        scenarioAssertionResults,
                      );
                      return (
                        <li key={`${script.id}/${scriptIndex}`}>
                          <button
                            type="button"
                            className="sr-script"
                            data-script-index={scriptIndex}
                            onClick={() => open(scriptIndex)}
                          >
                            <span className="sr-script-number">
                              {scriptIndex + 1}
                            </span>
                            <span className="sr-script-copy">
                              <strong>{script.name}</strong>
                              <small>
                                {
                                  scenarioDisplayStepGroups(run, scriptIndex)
                                    .length
                                }{' '}
                                {tr('项操作', 'actions')}
                                {checks.length > 0 &&
                                  ` · ${checks.filter((item) => item.status === 'passed').length}/${checks.length} ${tr('项检查通过', 'checks passed')}`}
                                {recovered > 0 && (
                                  <span className="sr-amber">
                                    {' '}
                                    · {tr('接管恢复', 'Recovered')} {recovered}
                                  </span>
                                )}
                              </small>
                            </span>
                            <Status value={script.status} tr={tr} />
                            <RightOutlined className="sr-chevron" />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </section>
                {run.evidenceError ||
                analysis?.limitations.length ||
                run.summary?.omittedSteps ? (
                  <section className="sr-limits">
                    <h2>{tr('验证范围', 'Verification limits')}</h2>
                    {run.evidenceError && <p>{run.evidenceError}</p>}
                    {analysis?.limitations.map((item, i) => (
                      <p key={i}>{item}</p>
                    ))}
                    {Boolean(run.summary?.omittedSteps) && (
                      <p>
                        {run.summary?.omittedSteps}{' '}
                        {tr(
                          '个步骤未纳入 AI 分析，执行记录仍完整保留。',
                          'steps omitted from AI analysis; execution records are retained.',
                        )}
                      </p>
                    )}
                  </section>
                ) : null}
                <footer className="sr-footer">
                  <span>
                    {tr('执行编号', 'Run ID')} · {run.id}
                  </span>
                  <details>
                    <summary>{tr('执行信息', 'Run details')}</summary>
                    <p>
                      {tr('结束时间', 'Finished')} ·{' '}
                      {date(run.finishedAt, run.language)}
                    </p>
                    <p>
                      {tr('步骤', 'Steps')} · {stats.steps}
                    </p>
                  </details>
                </footer>
                {!analysis &&
                  run.summary?.status === 'completed' &&
                  run.summary.text && (
                    <LegacyAnalysis
                      text={run.summary.text}
                      html={run.summary.format === 'html'}
                      tr={tr}
                    />
                  )}
              </div>
            )}
          </main>
        </div>
      </AntdApp>
    </ConfigProvider>
  );
}

function LegacyAnalysis({
  text,
  html,
  tr,
}: { text: string; html: boolean; tr: Translate }) {
  const plain = useMemo(
    () =>
      html
        ? new DOMParser().parseFromString(text, 'text/html').body.innerText
        : text,
    [text, html],
  );
  return (
    <details className="sr-raw">
      <summary>{tr('历史分析记录', 'Saved analysis')}</summary>
      <pre>{plain}</pre>
    </details>
  );
}

function ScriptDetail({
  run,
  scriptIndex,
  initialStep,
  resolve,
  tr,
  onBack,
}: {
  run: ScenarioRunState;
  scriptIndex: number;
  initialStep: number;
  resolve: ReturnType<typeof createScenarioEvidenceResolver>;
  tr: Translate;
  onBack(): void;
}) {
  const script = run.scripts[scriptIndex];
  const [stepIndex, setStepIndex] = useState(initialStep);
  const [playback, setPlayback] = useState<'script' | 'step'>();
  const step = script.steps?.[stepIndex];
  const groups = useMemo(
    () => scenarioDisplayStepGroups(run, scriptIndex),
    [run, scriptIndex],
  );
  const groupIndex = groups.findIndex((item) =>
    item.indices.includes(stepIndex),
  );
  const group = groups[groupIndex];
  const sourceSteps = useMemo(
    () => (group?.indices || []).map((index) => script.steps![index]),
    [group, script.steps],
  );
  const evidenceIds = useMemo(
    () => sourceSteps.map((item) => item.id),
    [sourceSteps],
  );
  const list = useRef<HTMLOListElement>(null);
  const evidence = useMemo(
    () => scenarioEvidenceFor(run, scriptIndex, evidenceIds, resolve),
    [run, scriptIndex, evidenceIds, resolve],
  );
  const scriptEvidence = useMemo(
    () => scenarioEvidenceFor(run, scriptIndex, undefined, resolve),
    [run, scriptIndex, resolve],
  );
  const operationDetails = useMemo(
    () =>
      group ? scenarioOperationDetails(run, scriptIndex, group, resolve) : [],
    [run, scriptIndex, group, resolve],
  );
  const replayEvidence = playback === 'script' ? scriptEvidence : evidence;
  const replayDimensions = scenarioEvidenceDimensions(
    replayEvidence.executions,
  );
  const animations = useMemo(
    () =>
      playback
        ? replayEvidence.executions.flatMap(({ execution }, index) => {
            const size = execution.tasks.find(
              (task) => task.uiContext?.shotSize,
            )?.uiContext?.shotSize;
            return size
              ? generateAnimationScripts(
                  execution,
                  -1,
                  size.width,
                  size.height,
                  index,
                ) || []
              : [];
          })
        : [],
    [replayEvidence, playback],
  );
  const [frameIndex, setFrameIndex] = useState<number>();
  const activeFrameIndex =
    frameIndex ?? scenarioGroupFrameIndex(evidence.frames, sourceSteps) ?? -1;
  const frame = evidence.frames[activeFrameIndex];
  const frameStep = sourceSteps
    .filter((item) => frame?.stepIds.includes(item.id))
    .at(-1);
  const frameDetail = operationDetails
    .filter((item) => item.stepIds.some((id) => frame?.stepIds.includes(id)))
    .at(-1);
  const framePhase = frame
    ? {
        before: tr('操作前', 'Before action'),
        after: tr('操作后', 'After action'),
        observed: tr('现场画面', 'Observed state'),
        failure: tr('失败现场', 'Failure evidence'),
      }[frame.phase]
    : '';
  const zoom = useRef<HTMLDialogElement>(null);
  const zoomButton = useRef<HTMLButtonElement>(null);
  const finding = run.summary?.analysis?.findings.find(
    (item) =>
      item.scriptIndex === scriptIndex &&
      item.stepIndex !== null &&
      group?.indices.includes(item.stepIndex),
  );
  const select = (index: number) => {
    setPlayback(undefined);
    setStepIndex(index);
    setFrameIndex(undefined);
  };
  useEffect(() => {
    list.current
      ?.querySelector('[aria-current="step"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [stepIndex]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !zoom.current?.open) {
        event.preventDefault();
        onBack();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onBack]);
  const result =
    finding?.evidence ||
    (step
      ? scenarioReportDetail(step.error || step.detail || '', run.language)
      : '');
  return (
    <div className="sr-detail">
      <header className="sr-detail-header">
        <button
          type="button"
          className="sr-back"
          onClick={onBack}
          aria-label={tr('返回概览', 'Back to overview')}
        >
          <ArrowLeftOutlined />
        </button>
        <div className="sr-detail-heading">
          <h1>{script.name}</h1>
          <small>
            {groups.length} {tr('项操作', 'actions')} ·{' '}
            <Status value={script.status} tr={tr} />
          </small>
        </div>
        <button
          type="button"
          className="sr-small-button"
          aria-label={
            playback === 'script'
              ? tr('结束回放', 'End replay')
              : tr('回放过程', 'Replay flow')
          }
          disabled={!scriptEvidence.frames.length}
          onClick={() =>
            setPlayback(playback === 'script' ? undefined : 'script')
          }
        >
          {playback === 'script' ? <PauseOutlined /> : <PlayCircleOutlined />}
          {playback === 'script'
            ? tr('结束回放', 'End replay')
            : tr('回放过程', 'Replay flow')}
        </button>
      </header>
      {(script.continuation?.reason || script.error) && (
        <p className="sr-script-notice">
          {script.continuation?.reason || script.error}
        </p>
      )}
      <div className="sr-detail-layout">
        <aside className="sr-step-panel">
          <div className="sr-panel-heading">
            {tr('操作流程', 'Actions')}
            <span>{groups.length}</span>
          </div>
          <ol ref={list}>
            {groups.map((item, index) => {
              const representative = script.steps![item.indices.at(-1)!];
              return (
                <li key={`${representative.id}/${index}`}>
                  <button
                    type="button"
                    className="sr-step"
                    aria-current={
                      item.indices.includes(stepIndex) ? 'step' : undefined
                    }
                    onClick={() => select(item.indices.at(-1)!)}
                  >
                    <span className={`sr-step-symbol ${representative.status}`}>
                      {representative.status === 'passed' ? (
                        <CheckOutlined />
                      ) : representative.status === 'failed' ||
                        representative.status === 'blocked' ? (
                        <CloseOutlined />
                      ) : (
                        '·'
                      )}
                    </span>
                    <span>
                      <span className="sr-step-name">
                        <small>{index + 1}</small>
                        {item.title}
                      </span>
                      {(representative.status !== 'passed' ||
                        representative.recovery) && (
                        <span className="sr-step-meta">
                          {representative.recovery?.status === 'recovered'
                            ? ''
                            : statusText(representative.status, tr)}
                          {representative.recovery?.status === 'recovered' && (
                            <span className="sr-amber">
                              {' '}
                              {tr('接管恢复', 'Recovered')}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>
        <section
          className="sr-inspector"
          aria-label={tr('步骤详情', 'Step details')}
        >
          {step ? (
            <>
              <div className="sr-selected-heading">
                <h2>
                  {group?.title || scenarioStepLabel(step, run.language).title}
                </h2>
                <Status value={step.status} tr={tr} />
              </div>
              {operationDetails.length > 0 && (
                <div className="sr-operation-details">
                  <ol aria-label={tr('具体操作', 'Operation details')}>
                    {operationDetails.map((item) => (
                      <li key={item.key}>
                        <button
                          type="button"
                          className="sr-operation-select"
                          aria-label={tr(
                            `查看“${item.target}”的执行画面`,
                            `Show evidence for ${item.target}`,
                          )}
                          aria-pressed={Boolean(
                            frame &&
                              item.stepIds.some((id) =>
                                frame.stepIds.includes(id),
                              ),
                          )}
                          disabled={
                            scenarioFrameIndex(
                              evidence.frames,
                              item.stepIds,
                            ) === undefined
                          }
                          onClick={() => {
                            setPlayback(undefined);
                            setFrameIndex(
                              scenarioFrameIndex(evidence.frames, item.stepIds),
                            );
                          }}
                        >
                          <span className="sr-operation-label">
                            <span>{item.action}</span>
                            <strong>{item.target}</strong>
                            {item.count > 1 && <small>× {item.count}</small>}
                          </span>
                          {item.valueKind && (
                            <span className="sr-operation-value">
                              <span className="sr-operation-arrow">→</span>
                              {item.valueKind === 'missing' ? (
                                ['pending', 'skipped'].includes(item.status) ? (
                                  statusText(item.status, tr)
                                ) : (
                                  tr(
                                    '未记录填写内容',
                                    'Input value not recorded',
                                  )
                                )
                              ) : (
                                <>
                                  {item.valueKind === 'observed' && (
                                    <small>
                                      {tr('现场值', 'Observed value')}{' '}
                                    </small>
                                  )}
                                  <span>
                                    {item.value === ''
                                      ? tr('（空）', '(empty)')
                                      : item.value}
                                  </span>
                                </>
                              )}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ol>
                  {operationDetails.some((item) => item.missingTarget) && (
                    <p className="sr-operation-note">
                      {tr(
                        '部分控件未保存名称，可对照下方画面或回放查看。',
                        'Some control names were not saved; use the screenshot or replay to identify them.',
                      )}
                    </p>
                  )}
                </div>
              )}
              {result && ['failed', 'blocked'].includes(step.status) && (
                <p className="sr-failure-note">{result}</p>
              )}
              {step.continuedAfterFailure && (
                <p className="sr-amber">
                  {tr(
                    '已按要求记录失败并继续执行。',
                    'Failure recorded; execution continued as requested.',
                  )}
                </p>
              )}
              <section className="sr-evidence">
                <header>
                  <h2>{tr('执行证据', 'Execution evidence')}</h2>
                  <div className="sr-evidence-tools">
                    {evidence.frames.length > 0 && (
                      <button
                        type="button"
                        className="sr-plain-button"
                        aria-label={tr('放大截图', 'Enlarge screenshot')}
                        ref={zoomButton}
                        onClick={() => zoom.current?.showModal()}
                        disabled={Boolean(playback)}
                      >
                        <ExpandOutlined />
                        {tr('放大', 'Enlarge')}
                      </button>
                    )}
                    {evidence.frames.length > 0 && (
                      <button
                        type="button"
                        className="sr-plain-button"
                        aria-label={
                          playback === 'step'
                            ? tr('查看画面', 'Show screenshot')
                            : tr('回放此步', 'Replay step')
                        }
                        disabled={
                          !evidence.executions.some(({ execution }) =>
                            execution.tasks.some(
                              (task) => task.uiContext?.shotSize,
                            ),
                          )
                        }
                        onClick={() =>
                          setPlayback(playback === 'step' ? undefined : 'step')
                        }
                      >
                        <PlayCircleOutlined />
                        {playback === 'step'
                          ? tr('查看画面', 'Show screenshot')
                          : tr('回放此步', 'Replay step')}
                      </button>
                    )}
                  </div>
                </header>
                <div className="sr-evidence-stage">
                  {playback && animations.length ? (
                    <Player
                      key={
                        playback === 'script'
                          ? `script/${scriptIndex}`
                          : `step/${stepIndex}`
                      }
                      hideVideoExport
                      autoPlay
                      replayScripts={animations}
                      imageWidth={replayDimensions?.width || 0}
                      imageHeight={replayDimensions?.height || 0}
                      onTaskChange={
                        playback === 'script'
                          ? (taskId) => {
                              if (!taskId) return;
                              const index = scenarioStepForTask(
                                run,
                                scriptIndex,
                                taskId,
                                resolve,
                              );
                              if (index !== undefined) {
                                setStepIndex(index);
                                setFrameIndex(undefined);
                              }
                            }
                          : undefined
                      }
                    />
                  ) : frame ? (
                    <img
                      src={frame.screenshot.base64}
                      data-evidence-task={frame.taskId}
                      alt={tr(
                        '本次执行采集的步骤画面',
                        'Step screenshot captured during this run',
                      )}
                      onError={(event) => {
                        event.currentTarget.alt = tr(
                          '证据图片无法载入',
                          'Evidence image could not be loaded',
                        );
                      }}
                    />
                  ) : (
                    <div className="sr-no-evidence">
                      {tr(
                        '此步骤没有可用的执行截图。',
                        'No execution screenshot is available for this step.',
                      )}
                    </div>
                  )}
                </div>
                <div className="sr-evidence-caption">
                  <span>
                    {playback
                      ? tr('执行过程回放', 'Execution replay')
                      : frame
                        ? [
                            framePhase,
                            frameDetail
                              ? `${frameDetail.action} · ${frameDetail.target}`
                              : frameStep &&
                                tr(
                                  `原始步骤 ${script.steps!.indexOf(frameStep) + 1}`,
                                  `Recorded step ${script.steps!.indexOf(frameStep) + 1}`,
                                ),
                            frame.pageSettled === false &&
                              tr('页面仍在变化', 'Page still changing'),
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : tr('此操作没有对应画面', 'No image for this action')}
                    {evidence.missing &&
                      ` · ${tr('部分证据缺失', 'Some evidence is missing')}`}
                  </span>
                  {evidence.frames.length > 1 && !playback && (
                    <div className="sr-frame-controls">
                      <button
                        type="button"
                        aria-label={tr('上一帧', 'Previous frame')}
                        disabled={activeFrameIndex <= 0}
                        onClick={() => setFrameIndex(activeFrameIndex - 1)}
                      >
                        ‹
                      </button>
                      <span>
                        {activeFrameIndex + 1}/{evidence.frames.length}
                      </span>
                      <button
                        type="button"
                        aria-label={tr('下一帧', 'Next frame')}
                        disabled={
                          activeFrameIndex >= evidence.frames.length - 1
                        }
                        onClick={() => setFrameIndex(activeFrameIndex + 1)}
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
              </section>
              <details className="sr-raw" key={groupIndex}>
                <summary>
                  {tr('操作明细', 'Action details')}
                  <span className="sr-raw-count">
                    {sourceSteps.length} {tr('条原始记录', 'raw records')}
                  </span>
                </summary>
                <div className="sr-meta">
                  <span>
                    {duration(
                      sourceSteps[0]?.startedAt,
                      sourceSteps.at(-1)?.finishedAt,
                    )}
                  </span>
                  <span>
                    {step.type === 'playwright-operation'
                      ? 'Playwright'
                      : tr('Agent 操作与断言', 'Agent action and check')}
                  </span>
                </div>
                {step.instruction && (
                  <div className="sr-requirement">
                    <small>{tr('原始要求', 'Original instruction')}</small>
                    <p>{step.instruction}</p>
                  </div>
                )}
                {result && <p className="sr-result">{result}</p>}
                {finding && (finding.impact || finding.recommendation) && (
                  <dl className="sr-analysis">
                    {finding.impact && (
                      <>
                        <dt>{tr('影响', 'Impact')}</dt>
                        <dd>{finding.impact}</dd>
                      </>
                    )}
                    {finding.recommendation && (
                      <>
                        <dt>{tr('建议', 'Next action')}</dt>
                        <dd>{finding.recommendation}</dd>
                      </>
                    )}
                  </dl>
                )}
                {step.agentTask && <AgentActions step={step} tr={tr} />}
                <ol className="sr-source-events">
                  {sourceSteps.map((source, index) => (
                    <li key={source.id}>
                      <span className="sr-source-number">
                        {(group?.indices[index] ?? stepIndex) + 1}
                      </span>
                      <div>
                        <p>
                          {scenarioReportDescription(
                            source.description,
                            run.language,
                          )}
                        </p>
                        {source.error && (
                          <p className="sr-red">{source.error}</p>
                        )}
                        {source.detail && (
                          <small>
                            {scenarioReportDetail(source.detail, run.language)}
                          </small>
                        )}
                      </div>
                      <Status value={source.status} tr={tr} />
                    </li>
                  ))}
                </ol>
                {step.recovery && (
                  <dl className="sr-raw-fields">
                    <dt>{tr('原始错误', 'Original error')}</dt>
                    <dd>{step.recovery.originalError}</dd>
                    <dt>{tr('现场判断', 'Observation')}</dt>
                    <dd>{step.recovery.observation}</dd>
                    <dt>{tr('接管操作', 'Recovery action')}</dt>
                    <dd>{step.recovery.instruction}</dd>
                    <dt>{tr('接管结果', 'Recovery outcome')}</dt>
                    <dd>{step.recovery.reason}</dd>
                    {step.recovery.attempts?.map((attempt, i) => (
                      <div key={i}>
                        <dt>
                          {tr('尝试', 'Attempt')} {i + 1}
                        </dt>
                        <dd>
                          {[
                            attempt.reason,
                            attempt.instruction,
                            attempt.error,
                            attempt.verification,
                          ]
                            .filter(Boolean)
                            .join('\n')}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </details>
              <dialog
                className="sr-zoom"
                ref={zoom}
                onClose={() => zoomButton.current?.focus()}
                onClick={(event) => {
                  if (event.target === event.currentTarget)
                    zoom.current?.close();
                }}
              >
                <div>
                  <header>
                    <strong>
                      {tr('操作证据', 'Action evidence')} · {groupIndex + 1}
                    </strong>
                    <button
                      type="button"
                      aria-label={tr('关闭', 'Close')}
                      onClick={() => zoom.current?.close()}
                    >
                      <CloseOutlined />
                    </button>
                  </header>
                  {frame && (
                    <img
                      src={frame.screenshot.base64}
                      alt={tr('执行证据原图', 'Original execution screenshot')}
                    />
                  )}
                </div>
              </dialog>
            </>
          ) : (
            <p>
              {tr(
                '此脚本未记录步骤详情。',
                'No step details were recorded for this script.',
              )}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function AgentActions({
  step,
  tr,
}: { step: ScenarioStepResult; tr: Translate }) {
  return (
    <ol className="sr-agent-actions">
      {step.agentTask?.actions.map((result, i) => (
        <li key={i}>
          <div>
            <span>
              {result.action.type === 'wait'
                ? tr(
                    `等待 ${result.action.milliseconds / 1000} 秒`,
                    `Wait ${result.action.milliseconds / 1000} s`,
                  )
                : result.action.instruction}
            </span>
            <Status value={result.status} tr={tr} />
          </div>
          {result.detail && <p>{result.detail}</p>}
        </li>
      ))}
    </ol>
  );
}
