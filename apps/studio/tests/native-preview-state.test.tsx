// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ConnectingPreview from '../src/renderer/components/ConnectingPreview';
import { NativeWebPreview } from '../src/renderer/components/MainContent/NativeWebPreview';
import { setStudioLanguage } from '../src/renderer/i18n';
import type { NativeBrowserState } from '../src/shared/native-browser';

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  setStudioLanguage('zh');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shows a network hint only after a connection has waited 10 seconds', async () => {
  const el = document.createElement('div');
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(createElement(ConnectingPreview, { iconSrc: 'web.svg' })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9999);
    });
    expect(el.textContent).not.toContain('请检查网络');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(el.textContent).toContain('连接时间较长，请检查网络或重试');
  } finally {
    await act(async () => root.unmount());
  }
});

it('reveals a stalled native connection hint and restores the native surface after readiness', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 10,
    y: 20,
    width: 800,
    height: 450,
    left: 10,
    top: 20,
    right: 810,
    bottom: 470,
    toJSON: () => ({}),
  });
  let state: NativeBrowserState = {
    available: true,
    id: 1,
    width: 1920,
    height: 1080,
    loadingSince: Date.now(),
  };
  const bridge = vi.fn(async () => state);
  vi.stubGlobal('studioRuntime', { nativeBrowserLayout: bridge });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        createElement(NativeWebPreview, {
          blocked: false,
          onSize: vi.fn(),
          onStatus: vi.fn(),
        }),
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(el.textContent).toContain('请检查网络');
    expect(bridge).toHaveBeenLastCalledWith(
      expect.objectContaining({ visible: false }),
    );
    state = { ...state, loadingSince: undefined };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(el.textContent).not.toContain('请检查网络');
    expect(bridge).toHaveBeenLastCalledWith(
      expect.objectContaining({ visible: true }),
    );
    expect(el.querySelector('.studio-native-preview-frame')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    el.remove();
  }
});
