import { describe, expect, rs, test } from '@rstest/core';
import type { ScenarioRunStep } from '../../src/scenario-contract';
import { ScenarioObservation } from '../../src/scenario-observation';

const operation: ScenarioRunStep = {
  id: 'save',
  type: 'agent-operation',
  description: '点击保存',
  instruction: '点击保存',
};
const assertion: ScenarioRunStep = {
  id: 'assert',
  type: 'agent-assertion',
  description: '保存成功',
  instruction: '出现保存成功提示，当前订单状态为已提交',
};
function setup(settleMs = 0) {
  const calls: string[] = [];
  const observedAssert = rs.fn(async (...args: any[]) => {
    calls.push('assert');
    return { pass: true, thought: 'observed' };
  });
  const observation = { startedAt: 1, endedAt: 2, aiAssert: observedAssert };
  const dispose = rs.fn(async () => {
    calls.push('dispose');
  });
  const stop = rs.fn(async () => {
    calls.push('stop');
    observation.endedAt = Date.now();
    return observation;
  });
  const agent = {
    opts: { aiContexts: { default: 'MOM application knowledge' } },
    startObserving: rs.fn(async () => {
      calls.push('baseline');
      return { stop, dispose };
    }),
    interface: {
      screenshotBase64: rs.fn(async () => 'data:image/png;base64,current'),
    },
    recordToReport: rs.fn(async () => {}),
    aiAssert: rs.fn(async (...args: any[]) => ({
      pass: true,
      thought: 'current',
    })),
  };
  const flush = rs.fn(async () => {
    calls.push('flush');
  });
  return {
    session: new ScenarioObservation(() => agent as any, flush, settleMs),
    agent,
    calls,
    observedAssert,
    stop,
    dispose,
  };
}
describe('scenario observation', () => {
  test('combined tasks use one live visual query and distinguish mismatches from inconclusive evidence', async () => {
    for (const verdict of ['passed', 'failed', 'blocked', 'invalid']) {
      const s = setup();
      const query = rs.fn(
        async (_prompt: { images: Array<{ url: string }> }) => ({
          verdict,
          reason:
            verdict === 'blocked'
              ? '分页区域被遮挡，无法判断'
              : '当前分页总数为2165',
        }),
      );
      const ask = rs.fn(async (...args: Parameters<typeof query>) =>
        JSON.stringify(await query(...args)),
      );
      Object.assign(s.agent, { aiAsk: ask });
      const task = { ...assertion, type: 'agent-task' as const };
      const done = s.session.assert(task, new AbortController().signal);
      if (verdict === 'passed' || verdict === 'failed') {
        expect(await done).toMatchObject({ pass: verdict === 'passed' });
      } else
        await expect(done).rejects.toThrow(
          verdict === 'blocked' ? '无法判断' : '模型未能完成断言',
        );
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][0].images[0].url).toBe(
        'data:image/png;base64,current',
      );
      expect(s.agent.aiAssert).not.toHaveBeenCalled();
    }
  });
  test('captures before the operation and combines historical frames with a fresh current image', async () => {
    const s = setup();
    const signal = new AbortController().signal;
    await s.session.begin(operation, signal);
    s.calls.push('click');
    s.session.operationCompleted();
    await s.session.assert(assertion, signal);
    expect(s.calls.indexOf('baseline')).toBeLessThan(s.calls.indexOf('click'));
    expect(s.calls.indexOf('click')).toBeLessThan(s.calls.indexOf('stop'));
    expect(s.observedAssert.mock.calls[0][0]).toEqual({
      prompt: assertion.instruction!,
      images: [
        {
          name: expect.stringContaining('CURRENT_PAGE'),
          url: 'data:image/png;base64,current',
        },
      ],
    });
    expect(s.observedAssert.mock.calls[0][2].context).toContain(
      'baseline is not proof',
    );
    expect(s.observedAssert.mock.calls[0][2].context).toContain(
      'BOTH must hold',
    );
    expect(s.observedAssert.mock.calls[0][2].context).toContain(
      'MOM application knowledge',
    );
    await s.session.assert(assertion, signal);
    expect(s.stop).toHaveBeenCalledTimes(1);
    expect(s.agent.interface.screenshotBase64).toHaveBeenCalledTimes(2);
    await s.session.clear();
    expect(s.calls.slice(-2)).toEqual(['flush', 'dispose']);
  });
  test('isolates scripts and does not invent history for a standalone assertion', async () => {
    const s = setup();
    const signal = new AbortController().signal;
    await s.session.begin(operation, signal);
    await s.session.clear();
    await s.session.assert(assertion, signal);
    expect(s.observedAssert).not.toHaveBeenCalled();
    expect(s.agent.aiAssert.mock.calls[0][2].context).toContain(
      'No preceding operation',
    );
  });
  test('sampling failure is evidence blocking, not a retry of a business operation', async () => {
    const s = setup();
    s.agent.startObserving.mockRejectedValueOnce(new Error('disconnected'));
    await s.session.begin(operation, new AbortController().signal);
    await expect(
      s.session.assert(assertion, new AbortController().signal),
    ).rejects.toThrow('证据不足');
    expect(s.observedAssert).not.toHaveBeenCalled();
  });
  test('cancellation interrupts the tail wait and disposes before the next run', async () => {
    const s = setup(1000);
    const abort = new AbortController();
    await s.session.begin(operation, abort.signal);
    s.session.operationCompleted();
    const running = s.session.assert(assertion, abort.signal);
    abort.abort();
    await expect(running).rejects.toThrow();
    await s.session.clear();
    expect(s.dispose).toHaveBeenCalledTimes(1);
    expect(s.observedAssert).not.toHaveBeenCalled();
  });
  test('model service failure blocks instead of becoming a business assertion failure', async () => {
    const s = setup();
    s.agent.aiAssert.mockResolvedValueOnce({
      pass: false,
      thought: undefined,
    } as any);
    await expect(
      s.session.assert(assertion, new AbortController().signal),
    ).rejects.toThrow('模型未能完成断言');
    expect(s.agent.startObserving).not.toHaveBeenCalled();
    expect(s.agent.aiAssert).toHaveBeenCalledTimes(1);
  });
});
