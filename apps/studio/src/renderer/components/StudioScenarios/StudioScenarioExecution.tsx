import { type ScenarioRunState, scenarioRunActive } from '@midscene/playground';
import { Button, Progress } from 'antd';
import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { BackIcon, EditIcon } from '../Recorder/assets/recorder-icons';
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
  onEditStep,
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
  onEditStep?: (scriptId: string, stepId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const active = scenarioRunActive(run);
  const total = run?.scripts.reduce((n, s) => n + s.totalSteps, 0) || 0;
  const completed = run?.scripts.reduce((n, s) => n + s.completedSteps, 0) || 0;
  const percent = total ? Math.floor((completed / total) * 100) : 0;
  const title =
    run?.scope === 'script' ? run.scripts[0]?.name : run?.scenarioName;
  const status = run ? runStatusLabel(run.status) : t('Starting execution');
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
          <span className="studio-execution-counter">
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
          aria-label={t('Completed steps')}
          aria-valuemin={0}
          aria-valuemax={total || 1}
          aria-valuenow={completed}
        >
          <Progress
            percent={percent}
            showInfo={false}
            size="small"
            status={
              run?.status === 'failed'
                ? 'exception'
                : run?.status === 'running'
                  ? 'active'
                  : run?.status === 'completed'
                    ? 'success'
                    : 'normal'
            }
            strokeColor={
              run?.status === 'failed'
                ? 'var(--midscene-status-error)'
                : run?.status === 'completed'
                  ? 'var(--midscene-status-success)'
                  : 'var(--midscene-brand)'
            }
          />
        </div>
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
        {error ? (
          <div className="studio-scenario-error" role="alert">
            {t(error)}
          </div>
        ) : null}
        {run?.error ? (
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
                open={index === run.scriptIndex || script.status === 'failed'}
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
                    {runStatusLabel(script.status)}
                  </span>
                </summary>
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
                      </div>
                      <span className="studio-execution-step-status">
                        {runStatusLabel(step.status)}
                      </span>
                      {!active && onEditStep ? (
                        <Button
                          type="text"
                          size="small"
                          title={t('Edit steps')}
                          icon={<EditIcon />}
                          aria-label={`${t('Edit step')} ${stepIndex + 1}`}
                          onClick={() => onEditStep(script.id, step.id)}
                        />
                      ) : null}
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ol>
        {run && !active ? (
          <section
            className="studio-execution-summary"
            aria-label={t('AI summary')}
          >
            <h4>{t('AI summary')}</h4>
            {run.summary?.status === 'completed' ? (
              <p>{run.summary.text}</p>
            ) : run.summary?.status === 'failed' ? (
              <p>
                {t('AI summary unavailable. Execution results are retained.')}
              </p>
            ) : (
              <output>{t('Generating summary…')}</output>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
