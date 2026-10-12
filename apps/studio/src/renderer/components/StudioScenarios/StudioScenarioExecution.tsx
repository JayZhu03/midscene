import { type ScenarioRunState, scenarioRunActive } from '@midscene/playground';
import { Button, Progress } from 'antd';
import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { BackIcon } from '../Recorder/assets/recorder-icons';
import { StudioScenarioReport } from './StudioScenarioReport';
import { runStatusLabel } from './StudioScriptSequence';

export function StudioScenarioExecution({
  run,
  error,
  pending,
  ready,
  onBack,
  onNext,
  onStop,
  canRestoreSession,
  onRestoreSession,
}: {
  run: ScenarioRunState | null;
  error: string | null;
  pending: boolean;
  ready: boolean;
  onBack: () => void;
  onNext: () => void;
  onStop: () => void;
  canRestoreSession?: boolean;
  onRestoreSession?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const active = scenarioRunActive(run);
  const hasStepError = (value: string) =>
    run?.scripts.some((script) =>
      script.steps?.some(
        (step) => step.error === value || step.detail === value,
      ),
    );
  const total = run?.scripts.reduce((n, s) => n + s.totalSteps, 0) || 0;
  const completed =
    run?.scripts.reduce(
      (n, s) =>
        n +
        (s.steps
          ? s.steps.filter((step) =>
              ['passed', 'failed', 'blocked'].includes(step.status),
            ).length
          : s.completedSteps),
      0,
    ) || 0;
  const percent = total ? Math.floor((completed / total) * 100) : 0;
  // A failed test can coexist with a finished execution. Reserve interruption
  // for runs which did not reach the remaining scripts.
  const hasFailures = run?.scripts.some(
    (script) =>
      script.status === 'failed' ||
      script.steps?.some((step) => step.status === 'failed'),
  );
  const finished =
    run?.status === 'completed' ||
    (run?.status === 'failed' &&
      hasFailures &&
      run.scripts.length > 0 &&
      run.scripts.every((script) =>
        ['passed', 'failed'].includes(script.status),
      ));
  const outcome =
    run?.status === 'blocked' || (run?.status === 'failed' && !finished)
      ? 'error'
      : finished
        ? hasFailures
          ? 'warning'
          : 'success'
        : 'normal';
  const scriptCounts = run
    ? ['passed', 'failed', 'blocked', ...(!active ? ['pending'] : [])]
        .map((state) => ({
          state,
          count: run.scripts.filter((script) => script.status === state).length,
        }))
        .filter(({ count }) => count > 0)
    : [];
  const title =
    run?.scope === 'script' ? run.scripts[0]?.name : run?.scenarioName;
  const status =
    run?.phase === 'recovering'
      ? t('Agent taking over')
      : run?.phase === 'checking'
        ? t('Checking prerequisites')
        : finished
          ? t(
              hasFailures
                ? 'Completed · Some failures'
                : 'Completed · All passed',
            )
          : run?.status === 'blocked'
            ? t('Execution blocked')
            : run?.status === 'failed'
              ? t('Execution interrupted')
              : run
                ? runStatusLabel(run.status)
                : t(error ? 'Unable to start execution' : 'Starting execution');
  const resultLabel = (status: string) =>
    status === 'pending' && !active
      ? t('Not executed')
      : runStatusLabel(status);
  useEffect(() => {
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>(
      '[data-current="true"]',
    );
    if (!container || !target) return;
    const bounds = container.getBoundingClientRect();
    const item = target.getBoundingClientRect();
    if (item.top < bounds.top || item.bottom > bounds.bottom)
      container.scrollTo?.({
        top: container.scrollTop + item.top - bounds.top - 12,
        behavior: 'smooth',
      });
  }, [run?.id, run?.scriptIndex, run?.stepIndex, run?.status]);
  return (
    <div className="studio-scenario-panel studio-scenario-detail studio-execution-page">
      <header className="studio-scenario-toolbar studio-scenario-toolbar-detail">
        <Button
          type="text"
          className="studio-scenario-back"
          icon={<BackIcon />}
          aria-label={t('Back to scenario')}
          title={t('Back to scenario')}
          onClick={onBack}
        />
        <h3 className="studio-scenario-detail-title" title={title}>
          {title || t('Execution')}
        </h3>
        <span />
      </header>
      <section
        className="studio-execution-progress"
        aria-label={t('Execution progress')}
      >
        {run?.sessionMode === 'fresh' ? (
          <div className="studio-execution-session-mode">
            {t('Fresh session')}
          </div>
        ) : null}
        <div className="studio-execution-progress-heading">
          <span
            className="studio-execution-state"
            data-running={run?.status === 'running' || (!run && !error)}
          >
            <span className="studio-execution-pulse" aria-hidden="true" />
            {status}
          </span>
          <span
            className="studio-execution-counter"
            title={t('Processed steps')}
          >
            {completed} / {total}
          </span>
          {run?.status === 'waiting' ? (
            <Button
              size="small"
              type="primary"
              disabled={pending || !ready}
              onClick={onNext}
            >
              {t('Next step')}
            </Button>
          ) : null}
          {active ? (
            <Button
              size="small"
              disabled={pending || !ready || run?.status === 'stopping'}
              onClick={onStop}
            >
              {t('Stop')}
            </Button>
          ) : null}
        </div>
        <div
          role="progressbar"
          tabIndex={0}
          aria-label={t('Processed steps')}
          aria-valuemin={0}
          aria-valuemax={total || 1}
          aria-valuenow={completed}
        >
          <Progress
            percent={percent}
            showInfo={false}
            size="small"
            status={
              outcome === 'error'
                ? 'exception'
                : run?.status === 'running'
                  ? 'active'
                  : outcome === 'success'
                    ? 'success'
                    : 'normal'
            }
            strokeColor={
              outcome === 'error'
                ? 'var(--midscene-status-error)'
                : outcome === 'warning'
                  ? 'var(--midscene-status-warning, #d89614)'
                  : outcome === 'success'
                    ? 'var(--midscene-status-success)'
                    : 'var(--midscene-brand)'
            }
          />
        </div>
        {scriptCounts.length ? (
          <div
            className="studio-execution-counts"
            aria-label={t('Script results')}
          >
            {t('Scripts')}:{' '}
            {scriptCounts
              .map(({ state, count }) => `${resultLabel(state)} ${count}`)
              .join(' · ')}
          </div>
        ) : null}
        {active && run ? (
          <div
            className="studio-execution-current"
            title={run.stepDescription || run.scripts[run.scriptIndex]?.name}
          >
            {run.status === 'waiting'
              ? run.scripts[run.scriptIndex]?.name
              : run.stepDescription || t('Preparing execution')}
          </div>
        ) : null}
      </section>
      {canRestoreSession && !active ? (
        <Button
          className="studio-execution-reopen"
          type="text"
          disabled={pending || !ready}
          onClick={onRestoreSession}
        >
          {t('Return to original session')}
        </Button>
      ) : null}
      <div className="studio-execution-body" ref={scrollRef}>
        {error && !hasStepError(error) ? (
          <div className="studio-scenario-error" role="alert">
            {t(error)}
          </div>
        ) : null}
        {run?.error && !hasStepError(run.error) && run.error !== error ? (
          <div className="studio-scenario-error" role="alert">
            {t(run.error)}
          </div>
        ) : null}
        {!run ? (
          <div className="studio-scenario-empty">
            {error ? t('Unable to start execution') : t('Preparing execution')}
          </div>
        ) : null}
        <ol className="studio-script-sequence studio-execution-sequence">
          {run?.scripts.map((script, index) => (
            <li
              key={script.id}
              className="studio-sequence-row"
              data-status={script.status}
            >
              <span className="studio-sequence-node">{index + 1}</span>
              <details
                className="studio-execution-script"
                open={
                  index === run.scriptIndex ||
                  script.status === 'failed' ||
                  script.status === 'blocked'
                }
              >
                <summary
                  data-current={
                    index === run.scriptIndex && run.status === 'waiting'
                      ? 'true'
                      : undefined
                  }
                >
                  <span className="studio-execution-script-name">
                    {script.name}
                  </span>
                  <span className="studio-sequence-status">
                    {resultLabel(script.status)}
                  </span>
                </summary>
                {script.continuation?.reason ? (
                  <details
                    className="studio-execution-recovery"
                    open={script.continuation.status === 'blocked'}
                  >
                    <summary>{t('Continuation check')}</summary>
                    <p>{t(script.continuation.reason)}</p>
                  </details>
                ) : null}
                <ol className="studio-execution-steps">
                  {script.steps?.map((step, stepIndex) => (
                    <li
                      key={`${step.id}-${stepIndex}`}
                      data-status={step.status}
                      data-current={
                        index === run.scriptIndex &&
                        stepIndex === run.stepIndex &&
                        run.status !== 'waiting'
                          ? 'true'
                          : undefined
                      }
                    >
                      <span
                        className="studio-execution-step-dot"
                        aria-hidden="true"
                      />
                      <div className="studio-execution-step-copy">
                        <span>{step.description}</span>
                        {step.detail || step.error ? (
                          <p>{t(step.error || step.detail || '')}</p>
                        ) : null}
                        {step.recovery ? (
                          <details className="studio-execution-recovery">
                            <summary>{t('Recovery record')}</summary>
                            <p>
                              {t('Original error')}:{' '}
                              {t(step.recovery.originalError)}
                            </p>
                            {step.recovery.observation ? (
                              <p>
                                {t('Observation')}:{' '}
                                {t(step.recovery.observation)}
                              </p>
                            ) : null}
                            {step.recovery.instruction ? (
                              <p>
                                {t('Recovery action')}:{' '}
                                {step.recovery.instruction}
                              </p>
                            ) : null}
                            {step.recovery.reason ? (
                              <p>
                                {t('Recovery result')}:{' '}
                                {t(step.recovery.reason)}
                              </p>
                            ) : null}
                          </details>
                        ) : null}
                      </div>
                      <span className="studio-execution-step-status">
                        {step.recovery?.status === 'running'
                          ? t('Agent taking over')
                          : step.recovery?.status === 'recovered'
                            ? t('Passed · Agent recovery')
                            : resultLabel(step.status)}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ol>
      </div>
      {run && !active ? <StudioScenarioReport key={run.id} run={run} /> : null}
    </div>
  );
}
