// @vitest-environment jsdom
import { ConfigProvider } from 'antd';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudioScriptSequence } from '../src/renderer/components/StudioScenarios/StudioScriptSequence';
import { compileScenarioScript } from '../src/renderer/components/StudioScenarios/script-model';
import { loadSequence } from '../src/renderer/components/StudioScenarios/sequence';
import {
  useScenarioExecution,
  useScenarioExecutionBusy,
} from '../src/renderer/components/StudioScenarios/useScenarioExecution';
import { StudioPlaygroundContext } from '../src/renderer/playground/useStudioPlayground';
import { scenarioSession } from './fixtures/scenario-script';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let element: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  element = document.createElement('div');
  document.body.append(element);
  root = createRoot(element);
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('supports accessible reordering and prevents edits during execution', async () => {
  const scripts = ['a', 'b'].map((id) =>
    compileScenarioScript({
      scenarioId: 'scene',
      id,
      name: id,
      session: scenarioSession(),
    }),
  );
  const change = vi.fn();
  const action = vi.fn();
  const open = vi.fn();
  let displayedSequence = loadSequence('scene', scripts);
  const render = (locked: boolean) =>
    act(async () =>
      root.render(
        <ConfigProvider theme={{ token: { motion: false } }}>
          <StudioScriptSequence
            scripts={scripts}
            sequence={displayedSequence}
            locked={locked}
            run={null}
            onChange={change}
            onOpen={open}
            onAction={action}
            canRun={!locked}
          />
        </ConfigProvider>,
      ),
    );
  await render(false);
  expect(element.querySelector('.studio-sequence-handle')).toBeNull();
  await act(async () =>
    element
      .querySelector('.studio-sequence-name')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      ),
  );
  expect(
    change.mock.calls[0][0].map((item: { id: string }) => item.id),
  ).toEqual(['b', 'a']);
  await act(async () =>
    element.querySelector<HTMLButtonElement>('.studio-sequence-name')?.click(),
  );
  expect(open).toHaveBeenCalledWith(scripts[0]);
  open.mockClear();
  await act(async () => {
    element.querySelector<HTMLElement>('.studio-sequence-row')!.click();
    element.querySelector<HTMLElement>('.studio-sequence-node')!.click();
    element.querySelector<HTMLElement>('.studio-script-count')!.click();
  });
  expect(open).toHaveBeenCalledTimes(3);
  open.mockClear();
  const actionButton = element.querySelector<HTMLButtonElement>(
    '[aria-label="Script actions"]',
  )!;
  const controlDrag = new Event('dragstart', {
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    actionButton.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    actionButton.dispatchEvent(controlDrag);
  });
  expect(controlDrag.defaultPrevented).toBe(true);
  await act(async () =>
    element
      .querySelector<HTMLButtonElement>('[aria-label="Script actions"]')
      ?.click(),
  );
  const singleRun = Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).find((item) => item.textContent === 'Run this script');
  expect(singleRun).toBeTruthy();
  await act(async () => singleRun!.click());
  expect(action).toHaveBeenCalledWith('run', scripts[0]);
  expect(open).not.toHaveBeenCalled();
  const rows = element.querySelectorAll<HTMLElement>('.studio-sequence-row');
  expect(rows[0].draggable).toBe(true);
  const drag = new Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(drag, 'dataTransfer', {
    value: { setData: vi.fn(), effectAllowed: '' },
  });
  await act(async () => {
    rows[0]
      .querySelector('.studio-sequence-name')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true }));
    rows[0].querySelector('.studio-sequence-name')!.dispatchEvent(drag);
  });
  const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
  Object.defineProperty(dragOver, 'dataTransfer', {
    value: { dropEffect: '' },
  });
  await act(async () => rows[1].dispatchEvent(dragOver));
  expect(rows[1].getAttribute('data-drop-position')).toBe('after');
  await act(async () =>
    rows[1].dispatchEvent(
      new Event('drop', { bubbles: true, cancelable: true }),
    ),
  );
  expect(
    change.mock.calls.at(-1)![0].map((item: { id: string }) => item.id),
  ).toEqual(['b', 'a']);
  expect(element.querySelector('[data-landed="true"]')).toBeNull();
  displayedSequence = change.mock.calls.at(-1)![0];
  await render(false);
  expect(rows[0].getAttribute('data-landed')).toBe('true');
  expect(element.querySelector('[data-drop-position]')).toBeNull();
  open.mockClear();
  await act(async () =>
    rows[0]
      .querySelector('.studio-sequence-name')!
      .dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
      ),
  );
  expect(open).not.toHaveBeenCalled();
  await act(async () => {
    rows[0].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    rows[0].querySelector<HTMLButtonElement>('.studio-sequence-name')!.click();
  });
  expect(open).toHaveBeenCalledWith(scripts[0]);
  await render(true);
  expect(rows[0].draggable).toBe(false);
  expect(
    element.querySelector<HTMLButtonElement>('[aria-label="Script actions"]')
      ?.disabled,
  ).toBe(true);
});

it('prevents double start and recovers a lost start response from backend state', async () => {
  vi.useFakeTimers();
  let api!: ReturnType<typeof useScenarioExecution>;
  let busy = false;
  function Probe() {
    api = useScenarioExecution();
    busy = useScenarioExecutionBusy();
    return null;
  }
  const state = {
    id: 'run',
    scenarioId: 'scene',
    status: 'running',
    scriptIndex: 0,
    stepIndex: 0,
    scripts: [],
  };
  let backend: { run: typeof state | null; busy: boolean } = {
    run: null,
    busy: false,
  };
  let posts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => {
      if (options.method === 'POST') {
        posts++;
        backend = { run: state, busy: true };
        throw new Error('Lost response');
      }
      return { ok: true, json: async () => structuredClone(backend) };
    }),
  );
  const context = {
    phase: 'ready',
    serverUrl: 'http://localhost:1234',
    controller: {
      state: { serverOnline: true, sessionViewState: { connected: true } },
    },
  };
  await act(async () =>
    root.render(
      <StudioPlaygroundContext.Provider value={context as any}>
        <Probe />
      </StudioPlaygroundContext.Provider>,
    ),
  );
  expect(api.canStart).toBe(true);
  await act(async () => {
    const plan = { scenarioId: 'scene', scripts: [] };
    await Promise.all([api.start(plan), api.start(plan)]);
  });
  expect(posts).toBe(1);
  expect(busy).toBe(true);
  expect(api.ready).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(2500));
  expect(api.run?.id).toBe('run');
  expect(api.locked).toBe(true);
  backend = { run: { ...state, status: 'completed' }, busy: false };
  await act(async () => vi.advanceTimersByTimeAsync(750));
  expect(api.run?.status).toBe('completed');
  expect(busy).toBe(false);
});

it('refreshes preview metadata once per browser switch, including consecutive fresh sessions and restore', async () => {
  vi.useFakeTimers();
  let api!: ReturnType<typeof useScenarioExecution>;
  function Probe() {
    api = useScenarioExecution();
    return null;
  }
  let sessionId = 'original';
  const refresh = vi.fn(async () => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        run: null,
        busy: false,
        previewSessionId: sessionId,
      }),
    })),
  );
  const context = {
    phase: 'ready',
    serverUrl: 'http://localhost:1234',
    controller: {
      state: { serverOnline: true, sessionViewState: { connected: true } },
      actions: { refreshServerState: refresh },
    },
  };
  await act(async () =>
    root.render(
      <StudioPlaygroundContext.Provider value={context as any}>
        <Probe />
      </StudioPlaygroundContext.Provider>,
    ),
  );
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(2500));
  expect(refresh).toHaveBeenCalledTimes(1);
  for (const id of ['fresh-1', 'fresh-2']) {
    sessionId = id;
    await act(async () => vi.advanceTimersByTimeAsync(2500));
  }
  expect(refresh).toHaveBeenCalledTimes(3);
  sessionId = 'restored';
  await act(async () => api.restoreSession());
  expect(refresh).toHaveBeenCalledTimes(4);
});
