// @vitest-environment jsdom
import type { PlaygroundControllerResult } from '@midscene/playground-app';
import { type ReactNode, act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StudioPlaygroundReadyProvider from '../src/renderer/playground/StudioPlaygroundReadyProvider';

type ControllerOptions = {
  onCountdownFinish?: () => void;
};

const { setFieldsValueMock, usePlaygroundControllerMock } = vi.hoisted(() => {
  const setFieldsValueMock = vi.fn();

  return {
    setFieldsValueMock,
    usePlaygroundControllerMock: vi.fn(
      () =>
        ({
          actions: {},
          state: {
            form: {
              setFieldsValue: setFieldsValueMock,
            },
            formValues: {},
          },
        }) as unknown as PlaygroundControllerResult,
    ),
  };
});

vi.mock('@midscene/playground-app', () => ({
  PlaygroundThemeProvider: ({ children }: { children: ReactNode }) => children,
  usePlaygroundController: usePlaygroundControllerMock,
}));

vi.mock('antd', () => ({
  Form: () => null,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('StudioPlaygroundReadyProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
    (window as { electronShell?: unknown }).electronShell = undefined;
    document.body.replaceChildren();
  });

  it('seeds the controller with the default Web platform', () => {
    renderToStaticMarkup(
      createElement(
        StudioPlaygroundReadyProvider,
        {
          refreshDiscoveredDevices: async () => undefined,
          restartPlayground: async () => undefined,
          setDiscoveryPollingPaused: () => undefined,
          serverUrl: 'http://127.0.0.1:5800',
        },
        createElement('div', null, 'child'),
      ),
    );

    expect(usePlaygroundControllerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialFormValues: { platformId: 'web' },
        serverUrl: 'http://127.0.0.1:5800',
      }),
    );
  });

  it('does not auto-select physical devices or minimize Studio in Web mode', () => {
    renderToStaticMarkup(
      createElement(StudioPlaygroundReadyProvider, {
        refreshDiscoveredDevices: async () => undefined,
        restartPlayground: async () => undefined,
        setDiscoveryPollingPaused: () => undefined,
        serverUrl: 'http://127.0.0.1:5800',
      }),
    );
    expect(setFieldsValueMock).not.toHaveBeenCalled();
    expect(
      (
        usePlaygroundControllerMock.mock.calls.at(-1) as unknown as [
          ControllerOptions,
        ]
      )[0].onCountdownFinish,
    ).toBeUndefined();
  });
});
