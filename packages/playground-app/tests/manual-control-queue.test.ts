import { describe, expect, it, rs } from '@rstest/core';
import { ManualControlQueue } from '../src/manual-interaction';

describe('ManualControlQueue', () => {
  it('preserves input order until the previous operation completes', async () => {
    const queue = new ManualControlQueue();
    let finish!: (value: { ok: boolean }) => void;
    const first = queue.enqueue(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const next = rs.fn(async () => ({ ok: true }));
    const second = queue.enqueue(next);
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
    finish({ ok: true });
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('discards queued clicks after failure and accepts a new deliberate operation', async () => {
    const queue = new ManualControlQueue();
    const first = queue.enqueue(async () => ({ ok: false, error: 'timeout' }));
    const stale = rs.fn(async () => ({ ok: true }));
    const second = queue.enqueue(stale);
    expect((await first).ok).toBe(false);
    expect((await second).ok).toBe(false);
    expect(stale).not.toHaveBeenCalled();
    const fresh = rs.fn(async () => ({ ok: true }));
    expect(await queue.enqueue(fresh)).toEqual({ ok: true });
    expect(fresh).toHaveBeenCalledTimes(1);
  });
});
