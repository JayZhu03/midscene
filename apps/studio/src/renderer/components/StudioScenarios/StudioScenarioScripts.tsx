import { Button, Form, Input, Modal } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { StudioRecordingSession } from '../../recorder/types';
import { useOptionalStudioRecorder } from '../../recorder/useStudioRecorder';
import { BackIcon } from '../Recorder/assets/recorder-icons';
import { StudioScenarioTimeline } from './StudioScenarioTimeline';
import {
  SCENARIO_NAVIGATION_EVENT,
  type ScenarioNavigationRequest,
} from './navigation';
import {
  SCENARIO_SCRIPT_NAME_MAX_LENGTH,
  type ScenarioScript,
  compileScenarioScript,
} from './script-model';
import { listScenarioScripts, saveScenarioScript } from './script-storage';
import type { StudioScenario } from './storage';

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
        mutationRef.current
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
    if (!recorder || mutationRef.current) return;
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

  return (
    <div
      className="studio-scenario-panel studio-scenario-detail"
      data-scenario-draft={protectedWork ? 'true' : undefined}
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
            if (phase === 'list') onBack();
            else if (phase === 'saved') {
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
        <button
          aria-label={t('Scenario actions')}
          className="studio-scenario-actions"
          disabled
          type="button"
        >
          •••
        </button>
      </header>
      <div className="studio-scenario-panel-body">
        <div className="studio-script-actions">
          {phase === 'list' ? (
            <Button
              type="primary"
              disabled={!recorder?.canStartRecording || loading}
              onClick={() => void start()}
            >
              {t('Record new script')}
            </Button>
          ) : null}
          {phase === 'recording' ? (
            <>
              <Button
                disabled={checkpointBusy}
                onClick={() => {
                  setCheckpointError(null);
                  setCheckpointOpen(true);
                }}
              >
                {t('Insert checkpoint')}
              </Button>
              <Button
                type="primary"
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
            <div className="studio-scenario-list">
              {scripts.map((script) => (
                <button
                  key={script.id}
                  aria-label={script.name}
                  className="studio-scenario-select studio-script-row"
                  type="button"
                  onClick={() => {
                    setViewedScript(script);
                    setPhase('saved');
                    setError(null);
                  }}
                >
                  <span className="studio-scenario-name" title={script.name}>
                    {script.name}
                  </span>
                  <span className="studio-script-count">
                    {script.steps.length}
                  </span>
                </button>
              ))}
            </div>
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
