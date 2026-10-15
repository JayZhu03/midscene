import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gpu = vi.hoisted(() => ({
  hardware: true,
  status: 'disabled_software',
  disabledByFlag: false,
  listeners: new Set<() => void>(),
  getInfo: vi.fn<() => Promise<unknown>>(),
}));

vi.mock('electron', () => ({
  app: {
    isHardwareAccelerationEnabled: () => gpu.hardware,
    getGPUFeatureStatus: () => ({ gpu_compositing: gpu.status }),
    getGPUInfo: () => gpu.getInfo(),
    commandLine: { hasSwitch: () => gpu.disabledByFlag },
    on: (_event: string, listener: () => void) => gpu.listeners.add(listener),
    off: (_event: string, listener: () => void) =>
      gpu.listeners.delete(listener),
  },
}));

import { nativeBrowserUsesSharedTexture } from '../src/main/playground/native-browser-gpu';

describe('native browser GPU startup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    gpu.hardware = true;
    gpu.status = 'disabled_software';
    gpu.disabledByFlag = false;
    gpu.listeners.clear();
    gpu.getInfo.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const gpuReady = () => {
    gpu.hardware = true;
    gpu.status = 'enabled';
    for (const listener of gpu.listeners) listener();
  };

  const expectReleased = () => {
    expect(gpu.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  };

  it('uses the ready GPU without querying or delaying launch', async () => {
    gpu.status = 'enabled';
    await expect(nativeBrowserUsesSharedTexture()).resolves.toBe(true);
    expect(gpu.getInfo).not.toHaveBeenCalled();
    expectReleased();
  });

  it('waits for GPU readiness instead of keeping the cold-start bitmap path', async () => {
    const selected = nativeBrowserUsesSharedTexture();
    await vi.advanceTimersByTimeAsync(150);
    gpuReady();
    await expect(selected).resolves.toBe(true);
    expect(gpu.getInfo).toHaveBeenCalledOnce();
    expectReleased();
  });

  it('does not treat an early hardware-acceleration status as final', async () => {
    gpu.hardware = false;
    const selected = nativeBrowserUsesSharedTexture();
    await vi.advanceTimersByTimeAsync(100);
    gpuReady();
    await expect(selected).resolves.toBe(true);
    expectReleased();
  });

  it('can observe readiness after the basic GPU query resolved', async () => {
    const selected = nativeBrowserUsesSharedTexture();
    await vi.advanceTimersByTimeAsync(150);
    gpu.status = 'enabled';
    // The readiness poll also covers an update whose notification was missed.
    await vi.advanceTimersByTimeAsync(25);
    await expect(selected).resolves.toBe(true);
    expectReleased();
  });

  it('respects explicit GPU disabling without a startup wait', async () => {
    gpu.disabledByFlag = true;
    await expect(nativeBrowserUsesSharedTexture()).resolves.toBe(false);
    expect(gpu.getInfo).not.toHaveBeenCalled();
    expectReleased();
  });

  it('falls back within one second even when GPU initialization never settles', async () => {
    gpu.getInfo.mockReturnValue(new Promise(() => {}));
    const selected = nativeBrowserUsesSharedTexture();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(selected).resolves.toBe(false);
    expectReleased();
  });

  it('handles a failed query and rechecks readiness for a later browser', async () => {
    gpu.getInfo.mockRejectedValue(new Error('GPU unavailable'));
    await expect(nativeBrowserUsesSharedTexture()).resolves.toBe(false);
    expectReleased();
    gpuReady();
    await expect(nativeBrowserUsesSharedTexture()).resolves.toBe(true);
    expectReleased();
  });
});
