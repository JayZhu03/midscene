import { type ScenarioRunState, scenarioRunActive } from '@midscene/playground';
import { Button, Dropdown } from 'antd';
import { t } from '../../i18n';
import {
  ReplayIcon,
  TimelineChevronIcon,
} from '../Recorder/assets/recorder-icons';
import { runStatusLabel } from './StudioScriptSequence';
import type { SessionMode } from './session-mode';

export function StudioRecordingDraftActions({
  run,
  starting,
  busy,
  saving,
  canReplay,
  canStop,
  onReplay,
  onStop,
  onSave,
  onDiscard,
}: {
  run: ScenarioRunState | null;
  starting: boolean;
  busy: boolean;
  saving: boolean;
  canReplay: boolean;
  canStop: boolean;
  onReplay: (mode: SessionMode) => void;
  onStop: () => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const active = starting || scenarioRunActive(run);
  const steps = run?.scripts[0]?.steps ?? [];
  const processed = steps.filter((step) =>
    ['passed', 'failed', 'blocked', 'stopped'].includes(step.status),
  ).length;
  const label = starting
    ? t('Starting replay')
    : run?.phase === 'recovering'
      ? t('Agent taking over')
      : run
        ? runStatusLabel(run.status)
        : '';
  return (
    <div className="studio-draft-toolbar">
      <div className="studio-draft-actions">
        <Button type="primary" disabled={busy || saving} onClick={onSave}>
          {t('Save script')}
        </Button>
        {active ? (
          <Button
            disabled={!canStop}
            onClick={onStop}
            icon={
              <span className="studio-recorder-floating-stop-button-icon" />
            }
          >
            {t(run?.status === 'stopping' ? 'Stopping' : 'Stop replay')}
          </Button>
        ) : (
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            overlayClassName="studio-scenario-menu"
            disabled={busy || saving || !canReplay}
            menu={{
              items: [
                { key: 'current', label: t('Use current session') },
                { key: 'fresh', label: t('Fresh session') },
              ],
              onClick: ({ key }) => {
                if (
                  !busy &&
                  !saving &&
                  canReplay &&
                  (key === 'current' || key === 'fresh')
                )
                  onReplay(key);
              },
            }}
          >
            <Button
              icon={<ReplayIcon />}
              disabled={busy || saving || !canReplay}
              aria-label={t('Replay script')}
            >
              {t('Replay script')}
              <span className="studio-draft-chevron" aria-hidden="true">
                <TimelineChevronIcon />
              </span>
            </Button>
          </Dropdown>
        )}
        <Button
          type="text"
          danger
          className="studio-draft-discard"
          disabled={busy || saving}
          onClick={onDiscard}
        >
          {t('Discard recording')}
        </Button>
      </div>
      {starting || run ? (
        <div className="studio-draft-progress" aria-live="polite">
          <div className="studio-execution-progress-heading">
            <span className="studio-execution-state" data-running={active}>
              <span className="studio-execution-pulse" />
              {label}
            </span>
            {steps.length > 0 ? (
              <span className="studio-execution-counter">
                {processed} / {steps.length}
              </span>
            ) : null}
          </div>
          <div
            className="studio-draft-progress-track"
            role="progressbar"
            tabIndex={0}
            aria-label={t('Replay progress')}
            aria-valuemin={0}
            aria-valuemax={steps.length || 1}
            aria-valuenow={processed}
          >
            <span
              style={{
                width: `${steps.length ? (processed / steps.length) * 100 : 0}%`,
              }}
            />
          </div>
          {run?.error && !steps.some((step) => step.error === run.error) ? (
            <div className="studio-scenario-error" role="alert">
              {t(run.error)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
