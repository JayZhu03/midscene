import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRecorderDelivery,
  stopRecorderDelivery,
} from '../src/main/playground/native-recorder-delivery';

const tap = (target = 'document:button', count = 1) => ({
  payload: { actionType: 'Tap' },
  url: 'https://example.test',
  clickTarget: target,
  clickCount: count,
});
afterEach(() => vi.useRealTimers());
describe('native recording delivery', () => {
  it('keeps rapid clicks on different targets and merges only a real double click', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const delivery = createRecorderDelivery(async () => {}, listener, vi.fn());
    await delivery.receive(tap('document:first'));
    await delivery.receive(tap('document:second', 2));
    await delivery.drain();
    expect(
      listener.mock.calls.map(([p]) => [p.clickTarget, p.payload.actionType]),
    ).toEqual([
      ['document:first', 'Tap'],
      ['document:second', 'Tap'],
    ]);
    listener.mockClear();
    await delivery.receive(tap());
    await delivery.receive(tap('document:button', 2));
    await delivery.receive(tap('document:button', 3));
    await delivery.drain();
    await vi.runAllTimersAsync();
    expect(listener.mock.calls.map(([p]) => p.payload.actionType)).toEqual([
      'DoubleClick',
      'Tap',
    ]);
  });

  it('does not lose or reorder an iframe action when its target detaches', async () => {
    const listener = vi.fn();
    const error = vi.fn();
    let resolve!: () => void;
    const wait = new Promise<void>((r) => {
      resolve = r;
    });
    let first = true;
    const delivery = createRecorderDelivery(
      async () => {
        if (first) {
          first = false;
          await wait;
          throw new Error('Frame detached');
        }
      },
      listener,
      error,
    );
    const a = delivery.receive(tap('frame:a'));
    const b = delivery.receive(tap('main:b'));
    expect(listener).not.toHaveBeenCalled();
    resolve();
    await Promise.all([a, b]);
    await delivery.drain();
    expect(listener.mock.calls.map(([p]) => p.clickTarget)).toEqual([
      'frame:a',
      'main:b',
    ]);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('accepts the final input while stopping and drains the final click before disabling', async () => {
    let enabled = true;
    const listener = vi.fn();
    const delivery = createRecorderDelivery(async () => {}, listener, vi.fn());
    await delivery.receive(tap());
    const stop = stopRecorderDelivery(
      async () => {
        expect(enabled).toBe(true);
        await delivery.receive({ ...tap(), payload: { actionType: 'Input' } });
        await delivery.receive(tap('document:save'));
      },
      () => delivery.drain(),
      () => {
        enabled = false;
      },
    );
    await stop;
    expect(enabled).toBe(false);
    expect(listener.mock.calls.map(([p]) => p.payload.actionType)).toEqual([
      'Tap',
      'Input',
      'Tap',
    ]);
  });

  it('flushes already received clicks even if the document closes during stop', async () => {
    const listener = vi.fn();
    const disable = vi.fn();
    const delivery = createRecorderDelivery(async () => {}, listener, vi.fn());
    await delivery.receive(tap());
    await expect(
      stopRecorderDelivery(
        async () => {
          throw new Error('closed');
        },
        () => delivery.drain(),
        disable,
      ),
    ).rejects.toThrow('closed');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(disable).toHaveBeenCalledTimes(1);
  });
});
