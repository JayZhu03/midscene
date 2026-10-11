// @vitest-environment jsdom
import type { PlaygroundControllerResult } from '@midscene/playground-app';
import type { StudioPlaygroundContextValue } from '@renderer/playground/types';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from '../src/renderer/components/Sidebar';
import { saveWebPage } from '../src/renderer/playground/saved-web-pages';
import { StudioPlaygroundContext } from '../src/renderer/playground/useStudioPlayground';

type ReadyStudioPlaygroundContextValue = Extract<
  StudioPlaygroundContextValue,
  { phase: 'ready' }
>;

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function createReadyContextValue(): ReadyStudioPlaygroundContextValue {
  return {
    phase: 'ready',
    serverUrl: 'http://127.0.0.1:5800',
    controller: {
      state: {
        form: {
          getFieldsValue: () => ({}),
          setFieldsValue: () => undefined,
        },
        formValues: {},
        runtimeInfo: null,
        sessionSetup: {
          fields: [],
          targets: [],
        },
        sessionViewState: {
          connected: false,
          setupState: 'idle',
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

function createConnectedWebContextValue() {
  const destroySession = vi.fn(async () => undefined);
  const createSession = vi.fn(async () => false);
  const setFieldsValue = vi.fn();
  const context = createReadyContextValue();

  context.controller.state = {
    ...context.controller.state,
    form: {
      getFieldsValue: () => ({}),
      setFieldsValue,
    },
    formValues: {
      platformId: 'web',
    },
    runtimeInfo: {
      platformId: 'web',
      title: 'Midscene Web Playground',
      interface: {
        type: 'puppeteer',
        description: 'Example Web Session',
      },
      preview: {
        kind: 'mjpeg',
        mjpegPath: '/mjpeg',
        screenshotPath: '/screenshot',
        capabilities: [{ kind: 'mjpeg' }],
      },
      executionUxHints: [],
      metadata: {
        sessionConnected: true,
        sessionDisplayName: 'Example Web Session',
        setupState: 'ready',
        url: 'https://example.test/',
      },
    },
    sessionViewState: {
      connected: true,
      setupState: 'ready',
    },
  } as unknown as PlaygroundControllerResult['state'];
  context.controller.actions = {
    ...context.controller.actions,
    createSession,
    destroySession,
  } as unknown as PlaygroundControllerResult['actions'];

  return {
    context,
    createSession,
    destroySession,
    setFieldsValue,
  };
}

beforeEach(() => localStorage.clear());
describe('Web sidebar', () => {
  it('offers only Workbench and no platform groups', () => {
    const html = renderToStaticMarkup(
      createElement(
        StudioPlaygroundContext.Provider,
        { value: createReadyContextValue() },
        createElement(Sidebar, {
          activeView: 'overview',
          onSelectOverview: vi.fn(),
          onSelectDevice: vi.fn(),
        }),
      ),
    );
    expect(html).toContain('Workbench');
    expect(html).not.toMatch(
      /Android|HarmonyOS|Platform|No devices|Computer|iOS/,
    );
  });
  it('reopens a saved page with its stored viewport and does not disconnect the active page', async () => {
    saveWebPage({
      url: 'https://second.test/',
      viewportWidth: 1280,
      viewportHeight: 720,
      headed: false,
    });
    saveWebPage({
      url: 'https://example.test/',
      viewportWidth: 1440,
      viewportHeight: 900,
      headed: false,
    });
    const { context, destroySession, createSession } =
      createConnectedWebContextValue();
    const onSelectDevice = vi.fn();
    const opened = vi.fn();
    window.addEventListener('studio:open-saved-page', opened);
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          createElement(
            StudioPlaygroundContext.Provider,
            { value: context },
            createElement(Sidebar, {
              activeView: 'device',
              onSelectOverview: vi.fn(),
              onSelectDevice,
            }),
          ),
        ),
      );
      await act(async () =>
        (
          container.querySelector(
            '[title="https://example.test/"]',
          ) as HTMLButtonElement
        ).click(),
      );
      expect(onSelectDevice).toHaveBeenCalledOnce();
      expect(destroySession).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
      await act(async () =>
        (
          container.querySelector(
            '[title="https://second.test/"]',
          ) as HTMLButtonElement
        ).click(),
      );
      expect((opened.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
        url: 'https://second.test/',
        viewportWidth: 1280,
      });
    } finally {
      await act(async () => root.unmount());
      window.removeEventListener('studio:open-saved-page', opened);
    }
  });
});
