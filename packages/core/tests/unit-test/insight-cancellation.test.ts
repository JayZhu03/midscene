import { Insight } from '@/agent/insight';
import type { ModelRuntime } from '@/ai-model';
import type { UIContext } from '@/types';
import { describe, expect, it, rs } from '@rstest/core';

describe('read-only insight cancellation', () => {
  it('forwards cancellation for live and fixed-window queries without changing existing calls', async () => {
    for (const fixed of [false, true]) {
      const call = rs.fn(async (..._args: unknown[]) => ({
        output: '{"verdict":"passed"}',
      }));
      const uiContext = {} as UIContext;
      const insight = new Insight(
        { createTypeQueryExecution: call } as never,
        () => ({}) as ModelRuntime,
        (_api, context) => context,
        fixed ? () => uiContext : undefined,
      );
      const abort = new AbortController();
      const prompt = {
        prompt: 'Evaluate current evidence',
        images: [{ name: 'CURRENT_PAGE', url: 'data:image/png;base64,AAAA' }],
      };
      await insight.aiAsk(prompt, { abortSignal: abort.signal });
      expect(call.mock.calls[0][5]).toMatchObject({
        abortSignal: abort.signal,
      });
      expect(call.mock.calls[0][4]).toBeTruthy();
      if (fixed) expect(call.mock.calls[0][5]).toMatchObject({ uiContext });
      await insight.aiQuery('Read current value', {
        abortSignal: abort.signal,
      });
      expect(call.mock.calls[1][5]).toMatchObject({
        abortSignal: abort.signal,
      });
      await insight.aiQuery('Legacy query');
      if (!fixed) expect(call.mock.calls[2]).toHaveLength(4);
    }
  });
  it('stops an in-flight visual query through its execution signal', async () => {
    const call = rs.fn(
      (...args: unknown[]) =>
        new Promise<never>((_resolve, reject) => {
          const signal = (args[5] as { abortSignal: AbortSignal }).abortSignal;
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const insight = new Insight(
      { createTypeQueryExecution: call } as never,
      () => ({}) as ModelRuntime,
      () => undefined,
    );
    const abort = new AbortController();
    const done = insight.aiAsk('Evaluate this screenshot', {
      abortSignal: abort.signal,
    });
    abort.abort(new Error('User stopped'));
    await expect(done).rejects.toThrow('User stopped');
    expect(call).toHaveBeenCalledTimes(1);
  });
});
