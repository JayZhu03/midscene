import { describe, expect, rs, test } from '@rstest/core';
import type { ScenarioRecovery } from '../../src/scenario-contract';
import {
  assessScenarioContinuation,
  recoverScenarioStep,
} from '../../src/scenario-recovery';
import { ScenarioRunner } from '../../src/scenario-runner';

function fixture() {
  const runner = new ScenarioRunner({
    scenarioId: 's',
    language: 'zh',
    scripts: [
      {
        id: 'a',
        name: 'Create order',
        startMode: 'automatic',
        steps: [
          {
            id: 'save',
            type: 'playwright-operation',
            description: 'Save order',
            code: 'await page.getByRole("button", {name:"Save"}).click();',
          },
        ],
      },
      {
        id: 'b',
        name: 'Use order',
        startMode: 'automatic',
        steps: [
          {
            id: 'use',
            type: 'agent-operation',
            description: 'Use order from A',
            instruction: 'Use order from A',
          },
        ],
      },
    ],
  });
  const context = {
    plan: runner.plan,
    state: runner.state,
    scriptIndex: 0,
    stepIndex: 0,
  };
  const evidence: ScenarioRecovery = {
    status: 'running',
    originalError: 'Timeout',
    startedAt: 1,
  };
  const agent = {
    aiQuery: rs.fn(
      async (_prompt: string, _options: any): Promise<unknown> => ({
        decision: 'blocked',
        reason: 'Cannot establish submission status',
      }),
    ),
    aiAct: rs.fn(async (_prompt: string, _options: any) => {}),
  };
  const waitReady = rs.fn(async () => {});
  const signal = new AbortController().signal;
  return { context, evidence, agent, waitReady, signal };
}
describe('visual recovery protocol', () => {
  test('the recovery budget cancels the active action before returning', async () => {
    rs.useFakeTimers();
    try {
      const f = fixture();
      f.agent.aiQuery.mockResolvedValue({
        decision: 'act',
        reason: 'Unsaved',
        instruction: 'Click Save',
      });
      f.agent.aiAct.mockImplementation(
        async (_prompt, options) =>
          new Promise<void>((_resolve, reject) => {
            options.abortSignal.addEventListener(
              'abort',
              () => reject(options.abortSignal.reason),
              { once: true },
            );
          }),
      );
      const waiting = expect(
        recoverScenarioStep(
          f.agent,
          f.context,
          f.evidence,
          f.waitReady,
          f.signal,
        ),
      ).rejects.toThrow('timed out');
      await rs.advanceTimersByTimeAsync(120000);
      await waiting;
      expect(f.agent.aiAct).toHaveBeenCalledTimes(1);
      expect(f.agent.aiQuery).toHaveBeenCalledTimes(1);
    } finally {
      rs.useRealTimers();
    }
  });
  test('already completed operation is confirmed without duplicate submission', async () => {
    const f = fixture();
    f.agent.aiQuery.mockResolvedValue({
      decision: 'completed',
      reason: 'Order saved toast and ID visible',
    });
    expect(
      await recoverScenarioStep(
        f.agent,
        f.context,
        f.evidence,
        f.waitReady,
        f.signal,
      ),
    ).toBe(true);
    expect(f.agent.aiAct).not.toHaveBeenCalled();
    expect(f.evidence.observation).toContain('ID visible');
    expect(f.agent.aiQuery.mock.calls[0][0]).toContain('failedCode');
  });
  test('acts once then checks fresh evidence before marking recovery successful', async () => {
    const f = fixture();
    f.agent.aiQuery
      .mockResolvedValueOnce({
        decision: 'act',
        reason: 'Button moved; unsaved form visible',
        instruction: 'Click Save exactly once',
      })
      .mockResolvedValueOnce({
        completed: true,
        reason: 'Saved order ID visible',
      });
    expect(
      await recoverScenarioStep(
        f.agent,
        f.context,
        f.evidence,
        f.waitReady,
        f.signal,
      ),
    ).toBe(true);
    expect(f.agent.aiAct).toHaveBeenCalledTimes(1);
    expect(f.agent.aiQuery).toHaveBeenCalledTimes(2);
    expect(f.waitReady).toHaveBeenCalledTimes(2);
    expect(f.evidence.reason).toBe('Saved order ID visible');
  });
  test('a resolved action with negative verification is still a failed recovery', async () => {
    const f = fixture();
    f.agent.aiQuery
      .mockResolvedValueOnce({
        decision: 'act',
        reason: 'Unsaved',
        instruction: 'Click Save',
      })
      .mockResolvedValueOnce({
        completed: false,
        reason: 'Server rejected the order',
      });
    expect(
      await recoverScenarioStep(
        f.agent,
        f.context,
        f.evidence,
        f.waitReady,
        f.signal,
      ),
    ).toBe(false);
    expect(f.agent.aiAct).toHaveBeenCalledTimes(1);
    expect(f.evidence.reason).toContain('rejected');
  });
  test('ambiguous side effects never trigger a retry', async () => {
    const f = fixture();
    expect(
      await recoverScenarioStep(
        f.agent,
        f.context,
        f.evidence,
        f.waitReady,
        f.signal,
      ),
    ).toBe(false);
    expect(f.agent.aiAct).not.toHaveBeenCalled();
  });
  test('malformed decisions fail closed', async () => {
    const f = fixture();
    f.agent.aiQuery.mockResolvedValue({
      decision: 'yes',
      reason: 'looks okay',
    });
    await expect(
      recoverScenarioStep(
        f.agent,
        f.context,
        f.evidence,
        f.waitReady,
        f.signal,
      ),
    ).rejects.toThrow('reliable decision');
    f.agent.aiQuery.mockResolvedValue({
      allowed: 'true',
      reason: 'probably independent',
    });
    await expect(
      assessScenarioContinuation(f.agent, f.context, f.signal),
    ).rejects.toThrow('reliable decision');
    expect(f.agent.aiAct).not.toHaveBeenCalled();
  });
  test('stop after observation prevents the recovery action', async () => {
    const f = fixture();
    const stop = new AbortController();
    f.agent.aiQuery.mockImplementation(async () => {
      stop.abort(new Error('Stopped'));
      return { decision: 'act', reason: 'Ready', instruction: 'Click Save' };
    });
    await expect(
      recoverScenarioStep(
        f.agent,
        f.context,
        f.evidence,
        f.waitReady,
        stop.signal,
      ),
    ).rejects.toThrow('Stopped');
    expect(f.agent.aiAct).not.toHaveBeenCalled();
  });
  test('continuation is read-only and includes all prior failures and business intent', async () => {
    const f = fixture();
    f.context.scriptIndex = 1;
    f.context.state.scripts[0].status = 'failed';
    f.context.state.scripts[0].error = 'Order creation rejected';
    f.agent.aiQuery.mockResolvedValue({
      allowed: false,
      reason: 'Required order does not exist',
    });
    const result = await assessScenarioContinuation(
      f.agent,
      f.context,
      f.signal,
    );
    expect(result.allowed).toBe(false);
    expect(f.agent.aiQuery.mock.calls[0][0]).toContain(
      'Order creation rejected',
    );
    expect(f.agent.aiQuery.mock.calls[0][0]).toContain('Use order from A');
    expect(f.agent.aiAct).not.toHaveBeenCalled();
  });
});
