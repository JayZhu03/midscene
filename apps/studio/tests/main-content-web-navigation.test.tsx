// @vitest-environment jsdom
import type { PlaygroundControllerResult } from '@midscene/playground-app';
import type { PlaygroundExecutionStatus } from '@midscene/visualizer';
import type { StudioPlaygroundContextValue } from '@renderer/playground/types';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import MainContent from '../src/renderer/components/MainContent';
import {
  SCENARIO_NAVIGATION_EVENT,
  type ScenarioNavigationRequest,
} from '../src/renderer/components/StudioScenarios/navigation';
import type {
  StudioWorkbenchMenu,
  StudioWorkspaceMode,
} from '../src/renderer/components/StudioWorkspace/preferences';
import { setStudioLanguage } from '../src/renderer/i18n';
import { StudioPlaygroundContext } from '../src/renderer/playground/useStudioPlayground';
import { type StudioMode, StudioModeTab } from '../src/renderer/recorder/types';
import { StudioRecorderContext } from '../src/renderer/recorder/useStudioRecorder';

type ReadyStudioPlaygroundContextValue = Extract<
  StudioPlaygroundContextValue,
  { phase: 'ready' }
>;

(globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = 'test-version';

const studioModePanelMockState = vi.hoisted(() => ({
  executionStatus: null as PlaygroundExecutionStatus | null,
}));

vi.mock('@midscene/playground-app', () => ({
  PlaygroundPreview: () => createElement('div', { 'data-testid': 'preview' }),
  PlaygroundConversationPanel: () => null,
}));

vi.mock('../src/renderer/components/StudioModePanel', async () => {
  const React = await import('react');

  return {
    default: (props: {
      studioMode?: StudioMode;
      onHeaderChange?: (header: { actions?: React.ReactNode }) => void;
      onTimelineExecutionStatusChange?: (
        status: PlaygroundExecutionStatus,
      ) => void;
    }) => {
      React.useEffect(() => {
        if (studioModePanelMockState.executionStatus) {
          props.onTimelineExecutionStatusChange?.(
            studioModePanelMockState.executionStatus,
          );
        }
      }, [props]);
      React.useEffect(() => {
        props.onHeaderChange?.({
          actions: React.createElement('button', {
            'aria-label': 'Import replay',
          }),
        });
      }, [props.onHeaderChange]);
      return React.createElement('textarea', {
        'aria-label': 'API draft',
        'data-studio-mode': props.studioMode,
        defaultValue: '',
      });
    },
  };
});

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ reports: [] }) })),
  );
  studioModePanelMockState.executionStatus = null;
  localStorage.clear();
  setStudioLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function createRecorderContextValue(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      initialized: true,
      initializing: false,
      sessions: [],
      currentSessionId: null,
      isRecording: false,
      error: null,
    },
    currentSession: null,
    currentTarget: null,
    canStartRecording: false,
    startRecording: vi.fn(async () => null),
    stopRecording: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    renameSession: vi.fn(async () => undefined),
    selectSession: vi.fn(),
    generateSessionYaml: vi.fn(async () => ''),
    generateSessionCode: vi.fn(async () => ''),
    deleteSessionCode: vi.fn(async () => undefined),
    exportSessionJson: vi.fn(async () => undefined),
    exportSessionYaml: vi.fn(async () => undefined),
    exportSessionCode: vi.fn(async () => undefined),
    exportAllZip: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createConnectedWebContextValue(): ReadyStudioPlaygroundContextValue {
  return {
    phase: 'ready',
    serverUrl: 'http://127.0.0.1:5800',
    controller: {
      state: {
        form: {
          getFieldsValue: () => ({}),
          setFieldsValue: () => undefined,
        },
        formValues: {
          platformId: 'web',
        },
        runtimeInfo: {
          platformId: 'web',
          title: 'Midscene Web Playground',
          interface: {
            type: 'puppeteer',
            description: 'https://todomvc.com/examples/react/dist/',
          },
          preview: {
            kind: 'mjpeg',
            mjpegPath: '/mjpeg',
            screenshotPath: '/screenshot',
            capabilities: [{ kind: 'mjpeg' }],
          },
          executionUxHints: [],
          metadata: {
            sessionDisplayName: 'https://todomvc.com/examples/react/dist/',
          },
        },
        sessionSetup: {
          fields: [],
          targets: [],
        },
        serverOnline: true,
        isUserOperating: false,
        sessionMutating: false,
        playgroundSDK: {
          getRuntimeInfo: vi.fn(async () => null),
          getInterfaceInfo: vi.fn(async () => {
            throw new Error('server restarting');
          }),
          interact: vi.fn(async () => ({ ok: true })),
        },
        sessionViewState: {
          connected: true,
          setupState: 'ready',
        },
      },
      actions: {
        refreshSessionSetup: vi.fn(async () => undefined),
        createSession: vi.fn(async () => false),
        destroySession: vi.fn(async () => undefined),
      },
    } as unknown as PlaygroundControllerResult,
    discoveredDevices: {
      android: [],
      ios: [],
      computer: [],
      harmony: [],
      web: [],
    },
    refreshDiscoveredDevices: vi.fn(async () => undefined),
    restartPlayground: vi.fn(async () => undefined),
    setDiscoveryPollingPaused: vi.fn(),
  };
}

describe('MainContent web navigation', () => {
  it.each([true, false])(
    'only legacy preview needs a post-create refresh (native=%s)',
    async (native) => {
      vi.useFakeTimers();
      const { root, container, context } = await renderWorkspace();
      const sdk = context.controller.state.playgroundSDK!;
      vi.mocked(context.controller.actions.createSession).mockResolvedValue(
        true,
      );
      vi.mocked(sdk.getRuntimeInfo).mockResolvedValue({
        metadata: { nativePreview: native },
      } as any);
      try {
        await act(async () => {
          window.dispatchEvent(
            new CustomEvent('studio:open-saved-page', {
              detail: {
                url: 'https://example.com',
                name: 'Example',
                headed: false,
                viewportWidth: 1920,
                viewportHeight: 1080,
              },
            }),
          );
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1600);
        });
        expect(context.controller.actions.createSession).toHaveBeenCalledOnce();
        expect(sdk.getRuntimeInfo).toHaveBeenCalledOnce();
        if (native) expect(sdk.interact).not.toHaveBeenCalled();
        else
          expect(sdk.interact).toHaveBeenCalledWith({ actionType: 'Reload' });
      } finally {
        await act(async () => root.unmount());
        container.remove();
        vi.useRealTimers();
      }
    },
  );
  async function renderWorkspace({
    mode = 'original',
    recording = false,
    titlebarInsetRight = 0,
  }: {
    mode?: StudioWorkspaceMode;
    recording?: boolean;
    titlebarInsetRight?: number;
  } = {}) {
    const context = createConnectedWebContextValue();
    vi.mocked(
      context.controller.state.playgroundSDK!.getInterfaceInfo,
    ).mockResolvedValue({} as any);
    const recorder = createRecorderContextValue();
    recorder.state.isRecording = recording;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    function Workspace() {
      const [workspaceMode, setMode] = useState(mode);
      const [menu, setMenu] = useState<StudioWorkbenchMenu>('scenarios');
      const [studioMode, setStudioMode] = useState<StudioMode>(
        StudioModeTab.Record,
      );
      return createElement(MainContent, {
        activeView: 'device',
        workspaceMode,
        workbenchMenu: menu,
        onWorkspaceModeChange: setMode,
        onWorkbenchMenuChange: setMenu,
        studioMode,
        onStudioModeChange: setStudioMode,
        titlebarInsetRight,
      });
    }
    await act(async () => {
      root.render(
        createElement(
          StudioPlaygroundContext.Provider,
          { value: context },
          createElement(
            StudioRecorderContext.Provider,
            { value: recorder as any },
            createElement(Workspace),
          ),
        ),
      );
    });
    return { container, context, root };
  }

  it('keeps the original draft and browser preview while switching workspaces', async () => {
    const { container, context, root } = await renderWorkspace();
    const draft = container.querySelector<HTMLTextAreaElement>('textarea')!;
    const preview = container.querySelector('[data-testid="preview"]');
    const menus = container.querySelector('.studio-workspace-menus');
    draft.value = 'Keep my API draft';
    await act(async () => {
      draft.dispatchEvent(new Event('input', { bubbles: true }));
      container
        .querySelector<HTMLElement>('.ant-segmented-item:last-child')!
        .click();
    });
    expect(
      draft.closest<HTMLElement>('.studio-workspace-original')?.style.display,
    ).toBe('none');
    expect(container.querySelector('button[aria-label="Record"]')).toBeNull();
    expect(
      container.querySelector('button[aria-label="Import replay"]'),
    ).toBeNull();
    expect(container.querySelector('[role="tablist"]')?.textContent).toBe(
      'ScenariosExecution records',
    );
    expect(container.querySelector('.studio-workspace-menus')).toBe(menus);
    await act(async () => {
      container
        .querySelector<HTMLElement>(
          '.ant-tabs-tab[data-node-key="execution-records"]',
        )!
        .click();
    });
    expect(container.textContent).toContain('No execution records yet');
    await act(async () => {
      container
        .querySelector<HTMLElement>('.ant-segmented-item:first-child')!
        .click();
    });
    expect(container.querySelector('textarea')).toBe(draft);
    expect(container.querySelector('.studio-workspace-menus')).toBe(menus);
    expect(draft.value).toBe('Keep my API draft');
    expect(
      container.querySelector('button[aria-label="Import replay"]'),
    ).not.toBeNull();
    expect(
      draft.closest<HTMLElement>('.studio-workspace-original')?.style.display,
    ).toBe('');
    expect(container.querySelector('[data-testid="preview"]')).toBe(preview);
    expect(context.controller.actions.createSession).not.toHaveBeenCalled();
    expect(context.controller.actions.destroySession).not.toHaveBeenCalled();
    expect(context.restartPlayground).not.toHaveBeenCalled();
    await act(async () => {
      container
        .querySelector<HTMLElement>('.ant-segmented-item:last-child')!
        .click();
    });
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe('Execution records');
    await act(async () => root.unmount());
    container.remove();
  });

  it('places the workspace switch in the safe top navigation and original tools in the shared panel tabs', async () => {
    const { container, root } = await renderWorkspace({
      titlebarInsetRight: 138,
    });
    const switcher = container.querySelector<HTMLElement>(
      '.studio-workspace-switch',
    )!;
    const navigation = switcher.closest<HTMLElement>('.app-drag')!;
    const workspace = container.querySelector('.studio-workspace')!;
    const draft = container.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(switcher.classList.contains('app-no-drag')).toBe(true);
    expect(switcher.classList.contains('ant-segmented-block')).toBe(true);
    expect(switcher.textContent).toBe('Original modeScenario mode');
    expect(navigation.style.paddingRight).toBe('138px');
    expect(workspace.contains(switcher)).toBe(false);
    expect(navigation.querySelector('[role="tablist"]')).toBeNull();
    expect(
      navigation.querySelector('button[aria-label="Import replay"]'),
    ).toBeNull();
    expect(
      workspace.querySelector('button[aria-label="Import replay"]'),
    ).not.toBeNull();
    expect(workspace.querySelector('[role="tablist"]')?.textContent).toBe(
      'RecordReplayAPI debugging',
    );
    expect(container.querySelector('button[aria-label="Record"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Replay"]')).toBeNull();
    expect(
      container.querySelector('button[aria-label="API Playground"]'),
    ).toBeNull();
    for (const mode of [
      StudioModeTab.Playground,
      StudioModeTab.Record,
      StudioModeTab.Replay,
    ]) {
      await act(async () => {
        workspace
          .querySelector<HTMLElement>(`.ant-tabs-tab[data-node-key="${mode}"]`)!
          .click();
      });
      expect(draft.dataset.studioMode).toBe(mode);
    }
    await act(async () => {
      switcher
        .querySelector<HTMLElement>('.ant-segmented-item:last-child')!
        .click();
    });
    expect(workspace.querySelector('[role="tablist"]')?.textContent).toBe(
      'ScenariosExecution records',
    );
    await act(async () => {
      switcher
        .querySelector<HTMLElement>('.ant-segmented-item:first-child')!
        .click();
    });
    expect(
      workspace.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe('Replay');
    expect(container.querySelector('textarea')).toBe(draft);
    await act(async () => root.unmount());
    container.remove();
  });

  it.each([
    ['original', true, false],
    ['workbench', true, false],
    ['original', false, true],
    ['workbench', false, true],
  ] as const)(
    'blocks switching from %s while recording=%s, executing=%s',
    async (mode, recording, executing) => {
      studioModePanelMockState.executionStatus = {
        running: executing,
        stoppable: executing,
        stop: vi.fn(),
      };
      const { container, root } = await renderWorkspace({ mode, recording });
      const inputs = Array.from(
        container.querySelectorAll<HTMLInputElement>('.ant-segmented input'),
      );
      expect(inputs).toHaveLength(2);
      expect(inputs.every((input) => input.disabled)).toBe(true);
      await act(async () => {
        container
          .querySelectorAll<HTMLElement>('.ant-segmented-item')
          [mode === 'original' ? 1 : 0].click();
      });
      expect(inputs[mode === 'original' ? 0 : 1].checked).toBe(true);
      expect(
        studioModePanelMockState.executionStatus.stop,
      ).not.toHaveBeenCalled();
      await act(async () => root.unmount());
      container.remove();
    },
  );

  it('renders the two workbench menus and empty states in Chinese', async () => {
    setStudioLanguage('zh');
    const { container, root } = await renderWorkspace({ mode: 'workbench' });
    expect(container.querySelector('.ant-segmented')?.textContent).toBe(
      '原版模式场景模式',
    );
    expect(container.querySelector('[role="tablist"]')?.textContent).toBe(
      '场景执行记录',
    );
    expect(container.textContent).toContain('暂无场景');
    await act(async () => root.unmount());
    setStudioLanguage('en');
    container.remove();
  });

  it('handles transient loading-state polling failures without throwing', async () => {
    const context = createConnectedWebContextValue();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    let renderError: unknown = null;
    await act(async () => {
      try {
        root.render(
          createElement(
            StudioPlaygroundContext.Provider,
            { value: context },
            createElement(
              StudioRecorderContext.Provider,
              { value: createRecorderContextValue() as any },
              createElement(MainContent, {
                activeView: 'device',
              }),
            ),
          ),
        );
      } catch (error) {
        renderError = error;
      }
    });
    await flushPromises();

    expect(renderError).toBeNull();
    expect(
      context.controller.state.playgroundSDK.getInterfaceInfo,
    ).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('stops active timeline execution before reloading the web page', async () => {
    const context = createConnectedWebContextValue();
    const calls: string[] = [];
    const stopTimelineExecution = vi.fn(async () => {
      calls.push('stop');
    });
    const interact = vi.fn(async ({ actionType }: { actionType: string }) => {
      calls.push(`interact:${actionType}`);
      return { ok: true };
    });
    context.controller.state.playgroundSDK.interact = interact;
    studioModePanelMockState.executionStatus = {
      running: true,
      stoppable: true,
      stop: stopTimelineExecution,
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          StudioPlaygroundContext.Provider,
          { value: context },
          createElement(
            StudioRecorderContext.Provider,
            { value: createRecorderContextValue() as any },
            createElement(MainContent, {
              activeView: 'device',
            }),
          ),
        ),
      );
    });
    await flushPromises();

    const reloadButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reload page"]',
    );
    expect(reloadButton).not.toBeNull();

    await act(async () => {
      reloadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(stopTimelineExecution).toHaveBeenCalledTimes(1);
    expect(interact).toHaveBeenCalledWith({ actionType: 'Reload' });
    expect(calls).toEqual(['stop', 'interact:Reload']);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('stops an active recorder before disconnecting the live session', async () => {
    const context = createConnectedWebContextValue();
    const stopDeferred = createDeferred<void>();
    const stopRecording = vi.fn(() => stopDeferred.promise);
    const destroySession = context.controller.actions
      .destroySession as ReturnType<typeof vi.fn>;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          StudioPlaygroundContext.Provider,
          { value: context },
          createElement(
            StudioRecorderContext.Provider,
            {
              value: createRecorderContextValue({
                state: {
                  initialized: true,
                  initializing: false,
                  sessions: [],
                  currentSessionId: 'recording-1',
                  isRecording: true,
                  error: null,
                },
                canStartRecording: true,
                stopRecording,
              }) as any,
            },
            createElement(MainContent, {
              activeView: 'device',
            }),
          ),
        ),
      );
    });

    const disconnectButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Disconnect"]',
    );
    expect(disconnectButton).not.toBeNull();

    await act(async () => {
      disconnectButton?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(destroySession).not.toHaveBeenCalled();

    await act(async () => {
      stopDeferred.resolve();
      await stopDeferred.promise;
      await Promise.resolve();
    });

    expect(destroySession).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('checks scenario drafts before saved-page opening or disconnect mutates the browser session', async () => {
    const { container, context, root } = await renderWorkspace({
      mode: 'workbench',
    });
    const setFields = vi.spyOn(context.controller.state.form, 'setFieldsValue');
    const block = (event: Event) =>
      (event as CustomEvent<ScenarioNavigationRequest>).detail.respond(false);
    window.addEventListener(SCENARIO_NAVIGATION_EVENT, block);
    try {
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent('studio:open-saved-page', {
            detail: {
              url: 'https://example.com/other',
              headed: false,
              viewportWidth: 1280,
              viewportHeight: 720,
            },
          }),
        );
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Disconnect"]')!
          .click();
      });
      expect(setFields).not.toHaveBeenCalled();
      expect(context.controller.actions.destroySession).not.toHaveBeenCalled();
      expect(context.controller.actions.createSession).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(SCENARIO_NAVIGATION_EVENT, block);
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
