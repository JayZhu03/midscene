import { Button, Dropdown, Form, Input, Modal } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { readStoredLanguage, t } from '../../i18n';
import type { StudioRecordingSession } from '../../recorder/types';
import { useOptionalStudioRecorder } from '../../recorder/useStudioRecorder';
import {
  BackIcon,
  CheckIcon,
  RecorderButtonIcon,
  ReplayIcon,
} from '../Recorder/assets/recorder-icons';
import { StudioScenarioExecution } from './StudioScenarioExecution';
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
  updateScenarioScriptSteps,
} from './script-storage';
import {
  type SequenceEntry,
  buildScenarioRun,
  loadSequence,
  reconcileSequence,
  saveSequence,
} from './sequence';
import {
  type SessionMode,
  loadSessionMode,
  saveSessionMode,
  sessionModeMenu,
} from './session-mode';
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
  const [sessionMode, setSessionMode] = useState<SessionMode>(() =>
    loadSessionMode(scenario.id),
  );
  const [executionPage, setExecutionPage] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const observedRunId = useRef<string | null>(null);
  useEffect(() => {
    if (execution.run && execution.run.id !== observedRunId.current) {
      observedRunId.current = execution.run.id;
      if (scenarioRunActive(execution.run) || startingRun)
        setExecutionPage(true);
      setStartingRun(false);
    }
  }, [execution.run?.id, startingRun]);
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
  const [editingScript, setEditingScript] = useState<ScenarioScript | null>(
    null,
  );
  const [editingSteps, setEditingSteps] = useState<ScenarioScript['steps']>([]);
  const [editBusy, setEditBusy] = useState(false);
  const editDirty = Boolean(
    editingScript &&
      JSON.stringify(editingSteps) !== JSON.stringify(editingScript.steps),
  );
  const editingRef = useRef(false);
  editingRef.current = editDirty;

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
    phase === 'draft' ||
    editDirty;
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
      } else if (phaseRef.current === 'draft' || editingRef.current) {
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
        editingRef.current ||
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

  const closeEditor = () => {
    setEditingScript(null);
    setEditingSteps([]);
    setError(null);
  };
  const cancelEditor = (afterDiscard?: () => void) => {
    if (mutationRef.current) return;
    if (!editDirty) {
      closeEditor();
      afterDiscard?.();
      return;
    }
    discardRequestRef.current?.(false);
    const resolve = (allowed: boolean) => {
      if (allowed) afterDiscard?.();
    };
    discardRequestRef.current = resolve;
    setDiscardRequest(() => resolve);
  };
  const openScript = (script: ScenarioScript) => {
    if (executionRef.current || mutationRef.current || protectedWork) return;
    setViewedScript(script);
    setPhase('saved');
    closeEditor();
    setExecutionPage(false);
    setError(null);
  };
  const clearDraft = async () => {
    if (editingRef.current) {
      closeEditor();
      return;
    }
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

  const saveEditedScript = async () => {
    if (
      !editingScript ||
      editBusy ||
      mutationRef.current ||
      executionRef.current
    )
      return;
    mutationRef.current = true;
    setEditBusy(true);
    setError(null);
    try {
      const saved = await updateScenarioScriptSteps(
        editingScript,
        editingSteps,
      );
      setScripts((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      setViewedScript(saved);
      closeEditor();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('Unable to update script.'),
      );
    } finally {
      setEditBusy(false);
      mutationRef.current = false;
    }
  };

  const startExecution = (
    selectedScripts: ScenarioScript[],
    selectedSequence: SequenceEntry[],
    scope: 'scenario' | 'script',
  ) => {
    if (
      executionRef.current ||
      protectedWork ||
      mutationRef.current ||
      !execution.canStart
    )
      return;
    setError(null);
    setViewedScript(null);
    closeEditor();
    setPhase('list');
    setStartingRun(true);
    setExecutionPage(true);
    void execution.start({
      ...buildScenarioRun(scenario.id, selectedScripts, selectedSequence),
      scenarioName: scenario.name,
      scope,
      language: readStoredLanguage(),
      sessionMode,
    });
  };
  const changeSessionMode = (mode: SessionMode) => {
    if (executionRef.current) return;
    try {
      saveSessionMode(scenario.id, mode);
      setSessionMode(mode);
      setError(null);
    } catch {
      setError(t('Unable to save session preference.'));
    }
  };
  if (executionPage)
    return (
      <StudioScenarioExecution
        run={startingRun ? null : run}
        error={execution.error}
        pending={execution.pending}
        ready={execution.ready}
        onBack={() => setExecutionPage(false)}
        onNext={() => void execution.next()}
        onStop={() => void execution.stop()}
        canRestoreSession={execution.isolatedSession && !execution.locked}
        onRestoreSession={() => void execution.restoreSession()}
      />
    );

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
            if (editDirty) {
              cancelEditor(() => {
                setViewedScript(null);
                setPhase('list');
              });
            } else if (phase === 'list') {
              if (executionRef.current)
                setError(t('Stop the scenario before leaving.'));
              else onBack();
            } else if (phase === 'saved') {
              closeEditor();
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
          disabled={editDirty || editBusy}
          overlayClassName="studio-scenario-menu"
          trigger={['click']}
          placement="bottomRight"
          menu={{
            selectedKeys: [`session-${sessionMode}`],
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
              { type: 'divider' },
              sessionModeMenu(
                sessionMode,
                execution.locked || execution.pending || protectedWork,
              ),
            ],
            onClick: ({ key }) => {
              if (key === 'session-current' || key === 'session-fresh') {
                changeSessionMode(
                  key === 'session-fresh' ? 'fresh' : 'current',
                );
                return;
              }
              if (executionRef.current || protectedWork || !sequenceReady)
                return;
              startExecution(scripts, sequence, 'scenario');
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
        {!editDirty && (run || startingRun) ? (
          <Button
            className="studio-execution-reopen"
            type="text"
            onClick={() => setExecutionPage(true)}
          >
            {t('View execution')}
            {run && !startingRun ? ` · ${runStatusLabel(run.status)}` : ''}
          </Button>
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
              sessionMode={sessionMode}
              onSessionModeChange={changeSessionMode}
              scripts={scripts}
              sequence={sequence}
              locked={execution.locked || execution.pending || !sequenceReady}
              canRun={execution.canStart && !actionBusy}
              onAction={(action, script) => {
                if (executionRef.current || mutationRef.current) return;
                if (action === 'edit') {
                  openScript(script);
                } else if (action === 'run') {
                  startExecution(
                    [script],
                    [{ id: script.id, startMode: 'automatic' }],
                    'script',
                  );
                } else {
                  setScriptAction({ type: action, script });
                  setActionName(script.name);
                  setActionError(null);
                }
              }}
              run={run}
              onOpen={openScript}
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
            steps={editingScript ? editingSteps : preview.steps}
            script={viewedScript}
            onChange={
              phase === 'saved' && viewedScript
                ? (steps) => {
                    if (executionRef.current || mutationRef.current) return;
                    if (!editingScript) setEditingScript(viewedScript);
                    setEditingSteps(steps);
                  }
                : undefined
            }
            onSave={() => void saveEditedScript()}
            onCancel={() => cancelEditor()}
            dirty={editDirty}
            busy={editBusy || execution.locked || execution.pending}
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
