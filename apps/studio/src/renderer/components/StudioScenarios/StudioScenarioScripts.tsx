import { Button, Dropdown, Form, Input, Modal } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { StudioRecordingSession } from '../../recorder/types';
import { useOptionalStudioRecorder } from '../../recorder/useStudioRecorder';
import {
  BackIcon,
  CheckIcon,
  RecorderButtonIcon,
  ReplayIcon,
} from '../Recorder/assets/recorder-icons';
import { StudioScenarioTimeline } from './StudioScenarioTimeline';
import { StudioScriptSequence, runStatusLabel } from './StudioScriptSequence';
import {
  SCENARIO_NAVIGATION_EVENT,
  type ScenarioNavigationRequest,
} from './navigation';
import {
  SCENARIO_SCRIPT_NAME_MAX_LENGTH,
  type ScenarioScript,
  compileScenarioScript,
} from './script-model';
import {
  deleteScenarioScript,
  listScenarioScripts,
  renameScenarioScript,
  saveScenarioScript,
} from './script-storage';
import {
  type SequenceEntry,
  buildScenarioRun,
  loadSequence,
  reconcileSequence,
  saveSequence,
} from './sequence';
import type { StudioScenario } from './storage';
import { useScenarioExecution } from './useScenarioExecution';

type Phase = 'list' | 'starting' | 'recording' | 'stopping' | 'draft' | 'saved';

export function StudioScenarioScripts({
  scenario,
  active,
  onBack,
}: {
  scenario: StudioScenario;
  active: boolean;
  onBack: () => void;
}) {
  const recorder = useOptionalStudioRecorder();
  const execution = useScenarioExecution();
  const [sequence, setSequence] = useState<SequenceEntry[]>([]);
  const [sequenceReady, setSequenceReady] = useState(false);
  const run =
    execution.run?.scenarioId === scenario.id ||
    scenarioRunActive(execution.run)
      ? execution.run
      : null;
  const executionRef = useRef(false);
  executionRef.current = execution.locked || execution.pending;
  const [phase, setPhase] = useState<Phase>('list');
  const [scripts, setScripts] = useState<ScenarioScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stoppedSession, setStoppedSession] =
    useState<StudioRecordingSession | null>(null);
  const [viewedScript, setViewedScript] = useState<ScenarioScript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [expectation, setExpectation] = useState('');
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [scriptName, setScriptName] = useState('');
  const [nameInvalid, setNameInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scriptAction, setScriptAction] = useState<{
    type: 'rename' | 'delete';
    script: ScenarioScript;
  } | null>(null);
  const [actionName, setActionName] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [discardRequest, setDiscardRequest] = useState<
    ((allowed: boolean) => void) | null
  >(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const mutationRef = useRef(false);
  const discardRequestRef = useRef<((allowed: boolean) => void) | null>(null);
  const session =
    stoppedSession ??
    (recorder?.currentSession?.id === sessionId
      ? recorder.currentSession
      : null);
  const preview = useMemo(() => {
    if (viewedScript) return { steps: viewedScript.steps, error: null };
    if (!session || (!session.events.length && !session.checkpoints?.length))
      return { steps: [], error: null };
    try {
      return {
        steps: compileScenarioScript({
          scenarioId: scenario.id,
          name: 'Recording',
          session,
        }).steps,
        error: null,
      };
    } catch (cause) {
      return {
        steps: [],
        error:
          cause instanceof Error
            ? cause.message
            : t('Unable to prepare script steps.'),
      };
    }
  }, [scenario.id, session, viewedScript]);
  const protectedWork =
    phase === 'starting' ||
    phase === 'recording' ||
    phase === 'stopping' ||
    phase === 'draft';
  const busy = phase === 'starting' || phase === 'stopping';

  useEffect(() => {
    let disposed = false;
    void listScenarioScripts(scenario.id)
      .then((result) => {
        if (!disposed) {
          setScripts(result);
          setSequence(loadSequence(scenario.id, result));
          setSequenceReady(true);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setLoading(false);
          // CRUD-only hosts do not provide a recorder/database.
          if (recorder)
            setError(
              cause instanceof Error
                ? cause.message
                : t('Unable to load scripts.'),
            );
        }
      });
    return () => {
      disposed = true;
    };
  }, [scenario.id, Boolean(recorder)]);

  useEffect(() => {
    const beforeNavigation = (event: Event) => {
      const request = (event as CustomEvent<ScenarioNavigationRequest>).detail;
      if (executionRef.current) {
        setError(t('Stop the scenario before leaving.'));
        request.respond(false);
        return;
      }
      if (
        ['starting', 'recording', 'stopping'].includes(phaseRef.current) ||
        mutationRef.current
      ) {
        setError(t('Stop recording before leaving.'));
        request.respond(false);
      } else if (phaseRef.current === 'draft') {
        request.respond(
          new Promise<boolean>((resolve) => {
            // A second click must not leave a first navigation promise unresolved.
            discardRequestRef.current?.(false);
            discardRequestRef.current = resolve;
            setDiscardRequest(() => resolve);
          }),
        );
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        ['starting', 'recording', 'stopping', 'draft'].includes(
          phaseRef.current,
        ) ||
        mutationRef.current ||
        executionRef.current
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener(SCENARIO_NAVIGATION_EVENT, beforeNavigation);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener(SCENARIO_NAVIGATION_EVENT, beforeNavigation);
      window.removeEventListener('beforeunload', beforeUnload);
      discardRequestRef.current?.(false);
    };
  }, []);

  const clearDraft = async () => {
    if (sessionId) await recorder?.releaseScenarioSession(sessionId);
    setSessionId(null);
    setStoppedSession(null);
    setViewedScript(null);
    setSaveOpen(false);
    setCheckpointOpen(false);
    phaseRef.current = 'list';
    setPhase('list');
  };
  const start = async () => {
    if (!recorder || mutationRef.current || executionRef.current) return;
    mutationRef.current = true;
    setPhase('starting');
    phaseRef.current = 'starting';
    setError(null);
    try {
      const started = await recorder.startRecording({
        scenarioId: scenario.id,
      });
      if (!started) throw new Error(t('Unable to start recording.'));
      setSessionId(started.id);
      setViewedScript(null);
      setStoppedSession(null);
      setPhase('recording');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Unable to start recording.'),
      );
      setPhase('list');
    } finally {
      mutationRef.current = false;
    }
  };
  const stop = async () => {
    if (!recorder || !sessionId || mutationRef.current || checkpointBusy)
      return;
    mutationRef.current = true;
    setPhase('stopping');
    phaseRef.current = 'stopping';
    setError(null);
    try {
      const completed = await recorder.stopScenarioRecording(sessionId);
      setStoppedSession(completed);
      setPhase('draft');
    } catch (cause) {
      // Keep a stopped draft retryable if compilation/persistence fails later.
      setError(
        cause instanceof Error ? cause.message : t('Unable to stop recording.'),
      );
      setPhase('recording');
    } finally {
      mutationRef.current = false;
    }
  };
  const addCheckpoint = async () => {
    if (!expectation.trim()) {
      setCheckpointError(t('Please enter an expectation.'));
      return;
    }
    if (!recorder || !sessionId || checkpointBusy) return;
    setCheckpointBusy(true);
    setCheckpointError(null);
    try {
      await recorder.addCheckpoint(sessionId, expectation);
      setCheckpointOpen(false);
      setExpectation('');
    } catch (cause) {
      setCheckpointError(
        cause instanceof Error
          ? cause.message
          : t('Unable to insert checkpoint.'),
      );
    } finally {
      setCheckpointBusy(false);
    }
  };
  const save = async () => {
    if (!scriptName.trim()) {
      setNameInvalid(true);
      return;
    }
    if (!stoppedSession || mutationRef.current) return;
    mutationRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const draft = compileScenarioScript({
        scenarioId: scenario.id,
        name: scriptName.trim(),
        session: stoppedSession,
      });
      const saved = await saveScenarioScript(draft, async (assetId) => {
        const url = recorder?.getRecorderScreenshotAssetUrl(assetId);
        if (!url) return null;
        const response = await fetch(url);
        if (!response.ok)
          throw new Error(t('Unable to save recording screenshots.'));
        return response.blob();
      });
      if (sessionId) await recorder?.releaseScenarioSession(sessionId);
      setScripts((current) => [...current, saved]);
      setSequence((current) => reconcileSequence([...scripts, saved], current));
      setViewedScript(saved);
      setStoppedSession(null);
      setSessionId(null);
      setSaveOpen(false);
      setPhase('saved');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Unable to save script. Please retry.'),
      );
    } finally {
      mutationRef.current = false;
      setSaving(false);
    }
  };

  const applyScriptAction = async () => {
    if (!scriptAction || mutationRef.current || executionRef.current) return;
    if (scriptAction.type === 'rename' && !actionName.trim()) {
      setActionError(t('Please enter a script name.'));
      return;
    }
    mutationRef.current = true;
    setActionBusy(true);
    setActionError(null);
    try {
      if (scriptAction.type === 'rename') {
        const renamed = await renameScenarioScript(
          scriptAction.script.id,
          actionName,
        );
        setScripts((current) =>
          current.map((script) =>
            script.id === renamed.id ? renamed : script,
          ),
        );
        setViewedScript((current) =>
          current?.id === renamed.id ? renamed : current,
        );
      } else {
        await deleteScenarioScript(scriptAction.script.id);
        setScripts((current) =>
          current.filter((script) => script.id !== scriptAction.script.id),
        );
        // Reconciliation removes stale IDs on the next load; no second write can undo a successful deletion.
        setSequence((current) =>
          current.filter((entry) => entry.id !== scriptAction.script.id),
        );
        if (viewedScript?.id === scriptAction.script.id) {
          setViewedScript(null);
          setPhase('list');
        }
      }
      setScriptAction(null);
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : t('Unable to update script.'),
      );
    } finally {
      mutationRef.current = false;
      setActionBusy(false);
    }
  };

  return (
    <div
      className="studio-scenario-panel studio-scenario-detail"
      data-scenario-draft={
        protectedWork || execution.locked || execution.pending
          ? 'true'
          : undefined
      }
    >
      <header className="studio-scenario-toolbar studio-scenario-toolbar-detail">
        <Button
          aria-label={t(
            phase === 'list' ? 'Back to scenarios' : 'Back to scenario',
          )}
          title={t(phase === 'list' ? 'Back to scenarios' : 'Back to scenario')}
          className="studio-scenario-back"
          icon={<BackIcon />}
          type="text"
          onClick={() => {
            if (phase === 'list') {
              if (executionRef.current)
                setError(t('Stop the scenario before leaving.'));
              else onBack();
            } else if (phase === 'saved') {
              setViewedScript(null);
              setPhase('list');
            } else if (phase === 'draft') {
              discardRequestRef.current?.(false);
              const resolve = (_allowed: boolean) => {};
              discardRequestRef.current = resolve;
              setDiscardRequest(() => resolve);
            } else setError(t('Stop recording before leaving.'));
          }}
        />
        <h3
          className="studio-scenario-detail-title"
          title={viewedScript?.name ?? scenario.name}
        >
          {viewedScript?.name ?? scenario.name}
        </h3>
        <Dropdown
          overlayClassName="studio-scenario-menu"
          trigger={['click']}
          placement="bottomRight"
          menu={{
            items: [
              {
                key: 'execute',
                label: t('Run scenario'),
                icon: <ReplayIcon />,
                disabled:
                  !scripts.length ||
                  !sequenceReady ||
                  !execution.canStart ||
                  actionBusy ||
                  Boolean(scriptAction) ||
                  execution.locked ||
                  execution.pending ||
                  protectedWork ||
                  loading ||
                  saving,
              },
            ],
            onClick: () => {
              if (executionRef.current || protectedWork || !sequenceReady)
                return;
              setError(null);
              void execution.start(
                buildScenarioRun(scenario.id, scripts, sequence),
              );
            },
          }}
        >
          <Button
            aria-label={t('Scenario actions')}
            className="studio-scenario-actions"
            type="text"
          >
            •••
          </Button>
        </Dropdown>
      </header>
      <div className="studio-scenario-panel-body">
        <div className="studio-script-actions studio-script-record-strip">
          {phase === 'list' ? (
            <Button
              type="primary"
              block
              icon={<RecorderButtonIcon />}
              disabled={
                !recorder?.canStartRecording ||
                loading ||
                execution.locked ||
                execution.pending
              }
              onClick={() => void start()}
            >
              {t('Record new script')}
            </Button>
          ) : null}
          {phase === 'recording' ? (
            <>
              <Button
                className="studio-script-checkpoint"
                aria-label={t('Insert checkpoint')}
                icon={<CheckIcon />}
                title={t('Insert checkpoint')}
                disabled={checkpointBusy}
                onClick={() => {
                  setCheckpointError(null);
                  setCheckpointOpen(true);
                }}
              />
              <Button
                className="studio-script-stop-recording"
                icon={
                  <span className="studio-recorder-floating-stop-button-icon" />
                }
                disabled={checkpointBusy}
                onClick={() => void stop()}
              >
                {t('Stop recording')}
              </Button>
            </>
          ) : null}
          {busy ? (
            <Button loading disabled>
              {t(
                phase === 'starting'
                  ? 'Starting recording'
                  : 'Finishing recognition',
              )}
            </Button>
          ) : null}
          {phase === 'draft' ? (
            <Button
              type="primary"
              disabled={saving}
              onClick={() => {
                setScriptName('');
                setNameInvalid(false);
                setError(null);
                setSaveOpen(true);
              }}
            >
              {t('Save script')}
            </Button>
          ) : null}
        </div>
        {run ? (
          <div className="studio-scenario-run-bar" aria-live="polite">
            <div className="studio-scenario-run-copy">
              <span>
                {runStatusLabel(run.status)} ·{' '}
                {Math.min(run.scriptIndex + 1, run.scripts.length)}/
                {run.scripts.length}
              </span>
              {['running', 'waiting', 'stopping'].includes(run.status) ? (
                <span
                  className="studio-scenario-run-step"
                  title={
                    run.stepDescription || run.scripts[run.scriptIndex]?.name
                  }
                >
                  {run.status === 'waiting'
                    ? run.scripts[run.scriptIndex]?.name
                    : run.stepDescription}
                </span>
              ) : null}
            </div>
            {run.status === 'waiting' ? (
              <Button
                type="primary"
                size="small"
                disabled={execution.pending || !execution.ready}
                onClick={() => void execution.next()}
              >
                {t('Next step')}
              </Button>
            ) : null}
            {['running', 'waiting', 'stopping'].includes(run.status) ? (
              <Button
                size="small"
                disabled={execution.pending || run.status === 'stopping'}
                onClick={() => void execution.stop()}
              >
                {t('Stop')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {execution.error || run?.error ? (
          <div
            className="studio-scenario-error studio-script-error"
            role="alert"
          >
            {t(execution.error || run?.error || '')}
          </div>
        ) : null}
        {error || preview.error ? (
          <div
            className="studio-scenario-error studio-script-error"
            role="alert"
          >
            {t(error ?? preview.error ?? '')}
          </div>
        ) : null}
        {phase === 'list' ? (
          loading ? (
            <div className="studio-scenario-empty">{t('Loading scripts')}</div>
          ) : scripts.length ? (
            <StudioScriptSequence
              scripts={scripts}
              sequence={sequence}
              locked={execution.locked || execution.pending || !sequenceReady}
              canRun={execution.canStart && !actionBusy}
              onAction={(action, script) => {
                if (executionRef.current || mutationRef.current) return;
                if (action === 'run') {
                  setError(null);
                  void execution.start(
                    buildScenarioRun(
                      scenario.id,
                      [script],
                      [{ id: script.id, startMode: 'automatic' }],
                    ),
                  );
                } else {
                  setScriptAction({ type: action, script });
                  setActionName(script.name);
                  setActionError(null);
                }
              }}
              run={run}
              onOpen={(script) => {
                setViewedScript(script);
                setPhase('saved');
                setError(null);
              }}
              onChange={(next) => {
                if (executionRef.current) return;
                try {
                  saveSequence(scenario.id, next);
                  setSequence(next);
                  setError(null);
                } catch {
                  setError(t('Unable to save script order.'));
                }
              }}
            />
          ) : (
            <div className="studio-scenario-empty">{t('No scripts yet')}</div>
          )
        ) : (
          <StudioScenarioTimeline
            steps={preview.steps}
            script={viewedScript}
            getScreenshotAssetUrl={recorder?.getRecorderScreenshotAssetUrl}
          />
        )}
      </div>
      <Modal
        open={active && Boolean(scriptAction)}
        title={t(
          scriptAction?.type === 'rename' ? 'Rename script' : 'Delete script',
        )}
        okText={t(scriptAction?.type === 'rename' ? 'Save' : 'Delete')}
        cancelText={t('Cancel')}
        width={400}
        okButtonProps={{ danger: scriptAction?.type === 'delete' }}
        confirmLoading={actionBusy}
        closable={!actionBusy}
        maskClosable={false}
        cancelButtonProps={{ disabled: actionBusy }}
        onCancel={() => setScriptAction(null)}
        onOk={() => void applyScriptAction()}
      >
        {scriptAction?.type === 'rename' ? (
          <Form component="div" layout="vertical">
            <Form.Item label={t('Script name')} required>
              <Input
                aria-label={t('Script name')}
                autoFocus
                value={actionName}
                maxLength={SCENARIO_SCRIPT_NAME_MAX_LENGTH}
                disabled={actionBusy}
                onChange={(event) => setActionName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void applyScriptAction();
                  }
                }}
              />
            </Form.Item>
          </Form>
        ) : (
          <p>
            {t('Delete this script?')}{' '}
            <strong>{scriptAction?.script.name}</strong>
          </p>
        )}
        {actionError ? (
          <div className="studio-scenario-error" role="alert">
            {t(actionError)}
          </div>
        ) : null}
      </Modal>
      <Modal
        open={active && checkpointOpen}
        title={t('Insert checkpoint')}
        okText={t('Insert')}
        cancelText={t('Cancel')}
        confirmLoading={checkpointBusy}
        maskClosable={false}
        closable={!checkpointBusy}
        cancelButtonProps={{ disabled: checkpointBusy }}
        onCancel={() => setCheckpointOpen(false)}
        onOk={() => void addCheckpoint()}
        width={400}
      >
        <Form component="div" layout="vertical">
          <Form.Item
            label={t('Expected result')}
            htmlFor="studio-script-expectation"
            required
          >
            <Input.TextArea
              id="studio-script-expectation"
              aria-label={t('Expected result')}
              autoSize={{ minRows: 3, maxRows: 8 }}
              value={expectation}
              onChange={(event) => setExpectation(event.target.value)}
            />
          </Form.Item>
        </Form>
        {checkpointError ? (
          <div className="studio-scenario-error" role="alert">
            {t(checkpointError)}
          </div>
        ) : null}
      </Modal>
      <Modal
        open={active && saveOpen}
        title={t('Save script')}
        okText={t('Save')}
        cancelText={t('Cancel')}
        confirmLoading={saving}
        maskClosable={false}
        closable={!saving}
        cancelButtonProps={{ disabled: saving }}
        onCancel={() => setSaveOpen(false)}
        onOk={() => void save()}
        width={400}
      >
        <Form component="div" layout="vertical">
          <Form.Item
            label={t('Script name')}
            htmlFor="studio-script-name"
            required
            validateStatus={nameInvalid ? 'error' : undefined}
            help={nameInvalid ? t('Please enter a script name.') : undefined}
          >
            <Input
              id="studio-script-name"
              aria-label={t('Script name')}
              maxLength={SCENARIO_SCRIPT_NAME_MAX_LENGTH}
              value={scriptName}
              onChange={(event) => {
                setScriptName(event.target.value);
                setNameInvalid(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void save();
                }
              }}
            />
          </Form.Item>
        </Form>
        {error ? (
          <div className="studio-scenario-error" role="alert">
            {t(error)}
          </div>
        ) : null}
      </Modal>
      <Modal
        open={Boolean(discardRequest)}
        title={t('Unsaved script')}
        okText={t('Discard')}
        cancelText={t('Keep editing')}
        okButtonProps={{ danger: true }}
        maskClosable={false}
        onCancel={() => {
          discardRequest?.(false);
          discardRequestRef.current = null;
          setDiscardRequest(null);
        }}
        onOk={() => {
          void clearDraft()
            .then(() => {
              discardRequest?.(true);
              discardRequestRef.current = null;
              setDiscardRequest(null);
            })
            .catch((cause: unknown) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : t('Unable to discard script.'),
              ),
            );
        }}
        width={360}
      >
        <p>{t('This script has not been saved. Discard it and leave?')}</p>
      </Modal>
    </div>
  );
}
import { scenarioRunActive } from '@midscene/playground';
