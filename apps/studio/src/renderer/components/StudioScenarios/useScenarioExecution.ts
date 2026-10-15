import {
  type ScenarioRunInput,
  type ScenarioRunState,
  scenarioRunActive,
} from '@midscene/playground';
import {
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { StudioPlaygroundContext } from '../../playground/useStudioPlayground';

let executionBusy = false;
const listeners = new Set<() => void>();
function publishBusy(value: boolean) {
  executionBusy = value;
  for (const listener of listeners) listener();
}
export function useScenarioExecutionBusy() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => executionBusy,
    () => false,
  );
}

interface ResponseState {
  run: ScenarioRunState | null;
  busy: boolean;
  isolatedSession?: boolean;
  previewSessionId?: string;
}
export function useScenarioExecution() {
  const playground = useContext(StudioPlaygroundContext);
  const serverUrl = playground?.phase === 'ready' ? playground.serverUrl : null;
  const connected =
    playground?.phase === 'ready' &&
    playground.controller.state.serverOnline &&
    playground.controller.state.sessionViewState.connected;
  const [run, setRun] = useState<ScenarioRunState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [isolatedSession, setIsolatedSession] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const acceptedRunId = useRef<string | undefined>(undefined);
  const previewSessionId = useRef<string | undefined>(undefined);
  const accept = (state: ResponseState) => {
    if (
      state.previewSessionId &&
      previewSessionId.current !== state.previewSessionId
    ) {
      previewSessionId.current = state.previewSessionId;
      if (playground?.phase === 'ready')
        void playground.controller.actions.refreshServerState();
    }
    if (state.run && acceptedRunId.current !== state.run.id) setError(null);
    acceptedRunId.current = state.run?.id;
    setRun(state.run);
    if (state.isolatedSession !== undefined)
      setIsolatedSession(state.isolatedSession);
    setLocked(state.busy || scenarioRunActive(state.run));
    publishBusy(
      scenarioRunActive(state.run) || Boolean(state.run && state.busy),
    );
  };
  const request = async (
    path: string,
    body?: unknown,
  ): Promise<ResponseState> => {
    if (!serverUrl)
      throw new Error('Connect a page before running a scenario.');
    const response = await fetch(
      `${serverUrl.replace(/\/$/, '')}/scenario-runs${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers:
          body === undefined
            ? undefined
            : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(
          path === '/session/restore' ? 60000 : 15000,
        ),
      },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error || 'Unable to communicate with scenario runner.',
      );
    return result;
  };
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    setReady(false);
    const poll = async () => {
      const version = generation.current;
      try {
        const state = await request('');
        if (!disposed && !inFlight.current && version === generation.current) {
          accept(state);
          setReady(true);
          setConnectionError(null);
        }
      } catch {
        if (!disposed) {
          setReady(false);
          setConnectionError('Execution status unavailable. Reconnecting…');
        }
      } finally {
        // Keep reconnecting even after a lost POST response; never infer success from a network error.
        if (!disposed) timer = setTimeout(poll, executionBusy ? 750 : 2500);
      }
    };
    if (serverUrl) void poll();
    return () => {
      disposed = true;
      alive.current = false;
      clearTimeout(timer);
    };
  }, [serverUrl]);

  const command = async (path: string, body: unknown) => {
    if (inFlight.current) return;
    inFlight.current = true;
    generation.current++;
    setPending(true);
    setError(null);
    if (path === '' || path === '/session/restore') {
      publishBusy(true);
      setLocked(true);
    }
    try {
      const state = await request(path, body);
      if (alive.current) {
        accept(state);
        setReady(true);
        setConnectionError(null);
      }
    } catch (cause) {
      if (alive.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to communicate with scenario runner.',
        );
        setReady(false);
      }
    } finally {
      inFlight.current = false;
      generation.current++;
      if (alive.current) setPending(false);
    }
  };
  return {
    run,
    error: error || connectionError,
    pending,
    ready,
    canStart: ready && connected,
    locked,
    isolatedSession,
    restoreSession: () => command('/session/restore', {}),
    start: (plan: ScenarioRunInput) => command('', plan),
    next: () =>
      run
        ? command(`/${run.id}/next`, { scriptIndex: run.scriptIndex })
        : Promise.resolve(),
    skip: () =>
      run
        ? command(`/${run.id}/skip`, { scriptIndex: run.scriptIndex })
        : Promise.resolve(),
    stop: () => (run ? command(`/${run.id}/stop`, {}) : Promise.resolve()),
  };
}
