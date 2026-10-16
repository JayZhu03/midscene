import { describe, expect, rs, test } from '@rstest/core';
import type { ScenarioRecovery } from '../../src/scenario-contract';
import { SCENARIO_PAGE_NOT_READY } from '../../src/scenario-readiness';
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
  test('waits through delayed loading without clicking again', async () => {
    rs.useFakeTimers();
    try {
      const f = fixture();
      f.waitReady.mockRejectedValueOnce(new Error(SCENARIO_PAGE_NOT_READY));
      f.agent.aiQuery
        .mockResolvedValueOnce({
          decision: 'wait',
          reason: 'Loading overlay visible',
        })
        .mockResolvedValueOnce({
          completed: true,
          reason: 'Saved order ID visible',
        });
      const result = recoverScenarioStep(
        f.agent,
        f.context,
        f.evidence,
        f.waitReady,
        f.signal,
      );
      await rs.advanceTimersByTimeAsync(1000);
      expect(await result).toBe(true);
      expect(f.agent.aiAct).not.toHaveBeenCalled();
      expect(f.evidence.attempts?.[0]).toMatchObject({
        strategy: 'wait',
        completed: true,
      });
    } finally {
      rs.useRealTimers();
    }
  });

  function withPreviousStep() {
    const f = fixture();
    f.context.plan.scripts[0].steps.unshift({
      id: 'open-menu',
      type: 'playwright-operation',
      description: 'Open orders menu',
      code: 'await page.getByText("Orders").click();',
    });
    f.context.state.scripts[0].steps!.unshift({
      id: 'open-menu',
      type: 'playwright-operation',
      description: 'Open orders menu',
      status: 'passed',
    });
    f.context.stepIndex = 1;
    return f;
  }

  test('can immediately repeat the previous click when navigation never happened', async () => {
    const f = withPreviousStep();
    f.context.plan.scripts[0].steps[1] = {
      id: 'search',
      type: 'playwright-operation',
      description: 'Search production orders',
      code: 'await page.getByRole("button", {name:"Search"}).click();',
    };
    f.agent.aiQuery
      .mockResolvedValueOnce({
        decision: 'backtrack',
        reason: 'Still on home page; Orders click did not navigate',
        instruction:
          'Click Orders again, confirm the orders page, then click Search',
        previousStepId: 'open-menu',
        safeToReplayPrevious: true,
        safetyEvidence: 'Orders is a navigation entry; no business mutation',
      })
      .mockResolvedValueOnce({
        completed: true,
        reason: 'Orders search results visible',
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
    expect(f.evidence.attempts).toMatchObject([
      { strategy: 'backtrack', previousStepId: 'open-menu', completed: true },
    ]);
    // The handoff includes the previous recorded operation, not just the failing locator.
    const query = f.agent.aiQuery.mock.calls[0][0];
    const facts = JSON.parse(query.split('Test context: ')[1]);
    expect(facts.previousOperation).toMatchObject({
      id: 'open-menu',
      goal: 'Open orders menu',
      executionStatus: 'passed',
      code: 'await page.getByText("Orders").click();',
    });
    expect(f.context.stepIndex).toBe(1);
  });

  test('does not replay a historical URL observation as a previous navigation action', async () => {
    const f = withPreviousStep();
    f.context.plan.scripts[0].steps[0].event = {
      hashId: 'observed',
      type: 'navigation',
      actionType: 'Navigate',
      url: 'https://example.test/orders',
      timestamp: 1,
      pageInfo: { width: 900, height: 600 },
      rawPayload: { implicitNavigationState: true },
    };
    f.agent.aiQuery.mockResolvedValueOnce({
      decision: 'backtrack',
      reason: 'Wrong page',
      instruction: 'Open the historical URL',
      previousStepId: 'open-menu',
      safeToReplayPrevious: true,
      safetyEvidence: 'Navigation only',
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
    expect(f.agent.aiAct).not.toHaveBeenCalled();
    const facts = JSON.parse(
      f.agent.aiQuery.mock.calls[0][0].split('Test context: ')[1],
    );
    expect(facts.backtrackAllowed).toBe(false);
    expect(facts.previousOperation).toBeUndefined();
  });

  test('restores the previous UI prerequisite after a transient failed attempt', async () => {
    const f = withPreviousStep();
    f.agent.aiQuery
      .mockResolvedValueOnce({
        decision: 'act',
        reason: 'Menu item visible',
        instruction: 'Select recorded item',
      })
      .mockResolvedValueOnce({
        completed: false,
        retryable: true,
        reason: 'Menu collapsed before click',
      })
      .mockResolvedValueOnce({
        decision: 'backtrack',
        reason: 'Reopen collapsed menu',
        instruction: 'Reopen Orders then select recorded item',
        previousStepId: 'open-menu',
        safeToReplayPrevious: true,
        safetyEvidence: 'Opening a navigation menu is read-only',
      })
      .mockResolvedValueOnce({
        completed: true,
        reason: 'Target page visible',
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
    expect(f.agent.aiAct).toHaveBeenCalledTimes(2);
    expect(f.evidence.attempts?.map((a) => a.strategy)).toEqual([
      'act',
      'backtrack',
    ]);
    expect(f.context.state.scripts[0].steps![0].status).toBe('passed');
    expect(f.agent.aiAct.mock.calls[1][0]).toContain('previous step open-menu');
  });

  test('observes after an action timeout instead of duplicating an already completed submission', async () => {
    const f = fixture();
    f.agent.aiQuery
      .mockResolvedValueOnce({
        decision: 'act',
        reason: 'Unsaved form',
        instruction: 'Click Save once',
      })
      .mockResolvedValueOnce({
        completed: true,
        reason: 'Order number visible',
      });
    f.agent.aiAct.mockRejectedValueOnce(new Error('Response timeout'));
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
    expect(f.evidence.attempts?.[0].error).toBe('Response timeout');
  });

  test('does not backtrack across assertions or accept unsafe/mismatched previous steps', async () => {
    for (const invalid of ['assertion', 'unsafe', 'wrong-id', 'not-passed']) {
      const f = withPreviousStep();
      if (invalid === 'assertion')
        f.context.plan.scripts[0].steps[0].type = 'agent-assertion';
      if (invalid === 'not-passed')
        f.context.state.scripts[0].steps![0].status = 'failed';
      f.agent.aiQuery.mockResolvedValueOnce({
        decision: 'backtrack',
        reason: 'Restore prerequisite',
        instruction: 'Reopen menu',
        previousStepId: invalid === 'wrong-id' ? 'save' : 'open-menu',
        safeToReplayPrevious: invalid !== 'unsafe',
        safetyEvidence: 'Read only',
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
      expect(f.agent.aiAct).not.toHaveBeenCalled();
    }
  });

  test('bounds transient retries to two action attempts', async () => {
    const f = fixture();
    for (let i = 0; i < 3; i++) {
      f.agent.aiQuery
        .mockResolvedValueOnce({
          decision: 'act',
          reason: 'Transient menu issue',
          instruction: 'Reopen menu',
        })
        .mockResolvedValueOnce({
          completed: false,
          retryable: true,
          reason: 'Menu still not responding',
        });
    }
    expect(
      await recoverScenarioStep(
        f.agent,
        f.context,
        f.evidence,
        f.waitReady,
        f.signal,
      ),
    ).toBe(false);
    expect(f.agent.aiAct).toHaveBeenCalledTimes(2);
  });

  test('a loading timeout after acting still obtains fresh visual evidence', async () => {
    const f = fixture();
    f.waitReady
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error(SCENARIO_PAGE_NOT_READY));
    f.agent.aiQuery
      .mockResolvedValueOnce({
        decision: 'act',
        reason: 'Unsaved form',
        instruction: 'Click Save once',
      })
      .mockResolvedValueOnce({
        completed: false,
        retryable: false,
        reason: 'Submission status uncertain',
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
    expect(f.agent.aiQuery).toHaveBeenCalledTimes(2);
    expect(f.evidence.reason).toBe('Submission status uncertain');
  });

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
  test('uses the current-run navigation contract without demanding the historical detail token', async () => {
    const f = fixture();
    const effect = {
      beforeUrl: 'https://example.test/app/#/orders',
      afterUrl:
        'https://example.test/app/#/object-detail/object-detail-1792131578759-56ydmi2o?from=%2Forders',
      observationStepId: 'detail',
      runtime: {
        beforeUrl: 'https://example.test/app/#/orders?run=current',
        targetUrl:
          'https://example.test/app/#/object-detail/object-detail-1792134966120-9x684516?from=%2Forders',
      },
    };
    f.agent.aiQuery.mockResolvedValue({
      decision: 'completed',
      reason: '目标订单详情已显示',
    });
    expect(
      await recoverScenarioStep(
        f.agent,
        f.context,
        f.evidence,
        f.waitReady,
        f.signal,
        effect,
      ),
    ).toBe(true);
    const [prompt, options] = f.agent.aiQuery.mock.calls[0];
    const facts = JSON.parse(prompt.split('Test context: ')[1]);
    expect(facts.navigationEffect).toMatchObject({
      expectedRoute:
        'https://example.test/app/#/object-detail/object-detail-:instance',
      beforeRoute: 'https://example.test/app/#/orders',
      liveTargetRoute: effect.runtime.targetUrl.split('?')[0],
      sourceRoute: '/orders',
      transientInstance: true,
    });
    expect(options.context).toContain(
      'Do not treat opening a different business object as success',
    );
    expect(f.agent.aiAct).not.toHaveBeenCalled();
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
