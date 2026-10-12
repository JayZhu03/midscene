import { describe, expect, rs, test } from '@rstest/core';
import type { ScenarioRunInput } from '../../src/scenario-contract';
import {
  ScenarioAssertionError,
  ScenarioFatalError,
  type ScenarioRecoveryHooks,
  ScenarioRunner,
} from '../../src/scenario-runner';

function setup() {
  const plan: ScenarioRunInput = {
    scenarioId: 'scene',
    scripts: ['A', 'B', 'C'].map((id) => ({
      id,
      name: id,
      startMode: 'automatic',
      steps: [0, 1].map((i) => ({
        id: `${id}${i}`,
        type: 'playwright-operation',
        description: `${id}${i}`,
      })),
    })),
  };
  const runner = new ScenarioRunner(plan);
  const recover = rs.fn<ScenarioRecoveryHooks['recover']>(
    async (_context, evidence) => {
      evidence.reason = 'Target is unavailable';
      return false;
    },
  );
  const canContinue = rs.fn<ScenarioRecoveryHooks['canContinue']>(async () => ({
    allowed: true,
    reason: 'Independent query',
  }));
  const calls: string[] = [];
  const execute = rs.fn(async (step: { id: string }) => {
    calls.push(step.id);
    if (step.id === 'A0') throw new Error('Locator changed');
  });
  return { plan, runner, recover, canContinue, calls, execute };
}
describe('scenario fallback policy', () => {
  test('recovers once and resumes at the next step without replaying the successful prefix', async () => {
    const s = setup();
    s.recover.mockImplementation(async (_context, evidence) => {
      evidence.reason = 'Saved successfully';
      return true;
    });
    await s.runner.run(s.execute, s);
    expect(s.calls).toEqual(['A0', 'A1', 'B0', 'B1', 'C0', 'C1']);
    expect(s.runner.state.status).toBe('completed');
    expect(s.runner.state.scripts[0].steps![0]).toMatchObject({
      status: 'passed',
      recovery: { status: 'recovered', originalError: 'Locator changed' },
    });
    expect(s.recover).toHaveBeenCalledTimes(1);
    expect(s.canContinue).not.toHaveBeenCalled();
  });
  test('failed recovery skips the remainder, gates all later scripts, and retains failure', async () => {
    const s = setup();
    await s.runner.run(s.execute, s);
    expect(s.calls).toEqual(['A0', 'B0', 'B1', 'C0', 'C1']);
    expect(s.runner.state.status).toBe('failed');
    expect(s.runner.state.scripts.map((r) => r.status)).toEqual([
      'failed',
      'passed',
      'passed',
    ]);
    expect(s.runner.state.scripts[0].steps![1].status).toBe('pending');
    expect(s.canContinue).toHaveBeenCalledTimes(2);
    expect(s.canContinue.mock.calls[1][0].state.scripts[0].status).toBe(
      'failed',
    );
  });
  test('a genuine assertion mismatch never invokes corrective actions and may continue independently', async () => {
    const s = setup();
    s.plan.scripts[0].steps[0].type = 'agent-assertion';
    s.execute.mockImplementation(async (step) => {
      s.calls.push(step.id);
      if (step.id === 'A0')
        throw new ScenarioAssertionError('2164 instead of 2165');
    });
    await s.runner.run(s.execute, s);
    expect(s.recover).not.toHaveBeenCalled();
    expect(s.calls).toEqual(['A0', 'B0', 'B1', 'C0', 'C1']);
    expect(s.runner.state.scripts[0].steps![0].error).toBe(
      '2164 instead of 2165',
    );
    expect(s.runner.state.status).toBe('failed');
  });
  test('missing business prerequisites block B and leave C unexecuted, even if B was manual', async () => {
    const s = setup();
    s.plan.scripts[1].startMode = 'manual';
    s.canContinue.mockResolvedValue({
      allowed: false,
      reason: 'A did not create the order required by B',
    });
    await s.runner.run(s.execute, s);
    expect(s.calls).toEqual(['A0']);
    expect(s.runner.state.scripts.map((r) => r.status)).toEqual([
      'failed',
      'blocked',
      'pending',
    ]);
    expect(s.runner.state.error).toContain('order required by B');
    expect(
      s.runner.state.scripts[1].steps!.every(
        (step) => step.status === 'pending',
      ),
    ).toBe(true);
  });
  test('an unavailable dependency judge blocks rather than guessing independence', async () => {
    const s = setup();
    s.canContinue.mockRejectedValue(new Error('Model unavailable'));
    await s.runner.run(s.execute, s);
    expect(s.runner.state.status).toBe('blocked');
    expect(s.runner.state.scripts[0].steps![0].recovery?.originalError).toBe(
      'Locator changed',
    );
    expect(s.calls).toEqual(['A0']);
  });
  test('stop during recovery waits for the active agent and never starts B', async () => {
    const s = setup();
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    s.recover.mockImplementation(async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return true;
    });
    const done = s.runner.run(s.execute, s);
    await ready;
    expect(s.runner.state.phase).toBe('recovering');
    s.runner.stop();
    expect(s.runner.state.status).toBe('stopping');
    release();
    await done;
    expect(s.runner.state.status).toBe('stopped');
    expect(s.runner.state.scripts[0].steps![0].recovery?.status).toBe(
      'stopped',
    );
    expect(s.calls).toEqual(['A0']);
  });
  test('stop during prerequisite inspection preserves previous failure and prevents the next script', async () => {
    const s = setup();
    s.canContinue.mockImplementation(async () => {
      s.runner.stop();
      return { allowed: true, reason: 'Independent' };
    });
    await s.runner.run(s.execute, s);
    expect(s.runner.state.status).toBe('stopped');
    expect(s.runner.state.scripts[1].continuation?.status).toBe('stopped');
    expect(s.runner.state.scripts[0].status).toBe('failed');
    expect(s.calls).toEqual(['A0']);
  });
  test('fatal browser preparation errors never invoke recovery or subsequent scripts', async () => {
    const s = setup();
    s.execute.mockRejectedValue(new ScenarioFatalError('Browser unavailable'));
    await s.runner.run(s.execute, s);
    expect(s.runner.state.status).toBe('failed');
    expect(s.recover).not.toHaveBeenCalled();
    expect(s.canContinue).not.toHaveBeenCalled();
    expect(s.runner.state.scripts[1].status).toBe('pending');
  });
});
