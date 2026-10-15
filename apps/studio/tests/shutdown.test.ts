import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerStudioShutdown } from '../src/main/shutdown';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(close = vi.fn<() => Promise<void>>().mockResolvedValue()) {
  let willQuit!: (event: { preventDefault(): void }) => void;
  const application = {
    on: (_event: 'will-quit', listener: typeof willQuit) => {
      willQuit = listener;
    },
    quit: vi.fn(),
  };
  const onError = vi.fn();
  registerStudioShutdown(application, close, onError);
  return {
    application,
    onError,
    close,
    request() {
      const event = { preventDefault: vi.fn() };
      willQuit(event);
      return event;
    },
  };
}

it('finishes cleanup once and allows the final quit to release the profile lock', async () => {
  const h = setup();
  expect(h.close).not.toHaveBeenCalled();
  expect(h.request().preventDefault).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.close).toHaveBeenCalledOnce();
  expect(h.application.quit).toHaveBeenCalledOnce();
  expect(h.request().preventDefault).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10000);
  expect(h.application.quit).toHaveBeenCalledOnce();
  expect(h.onError).not.toHaveBeenCalled();
});

it('bounds stalled cleanup and ignores duplicate requests and late completion', async () => {
  let release!: () => void;
  const h = setup(
    vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    ),
  );
  h.request();
  h.request();
  await vi.advanceTimersByTimeAsync(4999);
  expect(h.close).toHaveBeenCalledOnce();
  expect(h.application.quit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(h.application.quit).toHaveBeenCalledOnce();
  expect(h.onError).toHaveBeenCalledWith(
    expect.objectContaining({
      message: 'Studio runtime cleanup timed out after 5000ms.',
    }),
  );
  expect(h.request().preventDefault).not.toHaveBeenCalled();
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.application.quit).toHaveBeenCalledOnce();
});

it.each([false, true])(
  'still exits if cleanup fails (synchronous: %s)',
  async (sync) => {
    const error = new Error('Browser disconnected');
    const h = setup(
      vi.fn(() => {
        if (sync) throw error;
        return Promise.reject(error);
      }),
    );
    h.request();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onError).toHaveBeenCalledWith(error);
    expect(h.application.quit).toHaveBeenCalledOnce();
    expect(h.request().preventDefault).not.toHaveBeenCalled();
  },
);
