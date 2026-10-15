import { describe, expect, test } from '@rstest/core';
import type { ScenarioRunInput } from '../../src/scenario-contract';
import {
  ScenarioRunner,
  executeScenarioAgentStep,
  validateScenarioRun,
} from '../../src/scenario-runner';

function plan(): ScenarioRunInput {
  return {
    scenarioId: 'scene',
    scripts: ['a', 'b', 'c'].map((id) => ({
      id,
      name: id,
      startMode: 'automatic',
      steps: [
        { id, type: 'agent-assertion', description: id, instruction: id },
      ],
    })),
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('scenario execution', () => {
  test('skips only the waiting script, rejects stale commands and preserves the next manual boundary', async () => {
    const input = plan();
    input.scripts[1].startMode = 'manual';
    input.scripts[2].startMode = 'manual';
    const runner = new ScenarioRunner(input);
    const calls: string[] = [];
    const done = runner.run(async (step) => {
      calls.push(step.id);
    });
    expect(() => runner.skip(0)).toThrow();
    await tick();
    expect(() => runner.skip(0)).toThrow();
    runner.skip(1);
    expect(() => runner.skip(1)).toThrow();
    expect(() => runner.next(1)).toThrow();
    await tick();
    expect(runner.state.status).toBe('waiting');
    expect(runner.state.scriptIndex).toBe(2);
    expect(calls).toEqual(['a']);
    expect(runner.state.scripts[1]).toMatchObject({
      status: 'skipped',
      completedSteps: 0,
    });
    expect(runner.state.scripts[1].steps![0]).toMatchObject({
      status: 'skipped',
    });
    expect(runner.state.scripts[1].steps![0].startedAt).toBeUndefined();
    runner.skip(2);
    await done;
    expect(runner.state.status).toBe('completed');
    expect(calls).toEqual(['a']);
  });
  test('a skipped prerequisite still gates the next automatic script', async () => {
    for (const allowed of [true, false]) {
      const input = plan();
      input.scripts[1].startMode = 'manual';
      const runner = new ScenarioRunner(input);
      const calls: string[] = [];
      const done = runner.run(
        async (step) => {
          calls.push(step.id);
        },
        {
          recover: async () => false,
          canContinue: async (context) => {
            expect(context.state.scripts[1].status).toBe('skipped');
            return {
              allowed,
              reason: allowed
                ? 'Independent query'
                : 'Required order was not created',
            };
          },
        },
      );
      await tick();
      runner.skip(1);
      await done;
      expect(calls).toEqual(allowed ? ['a', 'c'] : ['a']);
      expect(runner.state.status).toBe(allowed ? 'completed' : 'blocked');
      expect(runner.state.scripts[1].status).toBe('skipped');
    }
  });
  test('stop immediately after skip preserves the skipped result and prevents further work', async () => {
    const input = plan();
    input.scripts[1].startMode = 'manual';
    const runner = new ScenarioRunner(input);
    const calls: string[] = [];
    const done = runner.run(async (step) => {
      calls.push(step.id);
    });
    await tick();
    runner.skip(1);
    runner.stop();
    await done;
    expect(runner.state.status).toBe('stopped');
    expect(runner.state.scripts[1].status).toBe('skipped');
    expect(calls).toEqual(['a']);
  });
  test('preserves order and pauses only before a later manual script', async () => {
    const input = plan();
    input.scripts[0].startMode = 'manual';
    input.scripts[1].startMode = 'manual';
    const runner = new ScenarioRunner(validateScenarioRun(input));
    const calls: string[] = [];
    const done = runner.run(async (step) => {
      calls.push(step.id);
    });
    await tick();
    expect(calls).toEqual(['a']);
    expect(runner.state.status).toBe('waiting');
    expect(() => runner.next(0)).toThrow();
    runner.next(1);
    expect(() => runner.next(1)).toThrow();
    await done;
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(runner.state.status).toBe('completed');
  });
  test('stopping a manual pause cannot execute subsequent scripts', async () => {
    const input = plan();
    input.scripts[1].startMode = 'manual';
    const runner = new ScenarioRunner(input);
    const calls: string[] = [];
    const done = runner.run(async (step) => {
      calls.push(step.id);
    });
    await tick();
    runner.stop();
    await done;
    expect(calls).toEqual(['a']);
    expect(runner.state.status).toBe('stopped');
    expect(() => runner.next(1)).toThrow();
  });
  test('an in-flight action must settle before stop completes and cannot continue', async () => {
    const runner = new ScenarioRunner(plan());
    let finish!: () => void;
    const calls: string[] = [];
    const done = runner.run(async (step, signal) => {
      calls.push(step.id);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      expect(signal.aborted).toBe(true);
    });
    runner.stop();
    expect(runner.state.status).toBe('stopping');
    finish();
    await done;
    expect(calls).toEqual(['a']);
    expect(runner.state.scripts[0].completedSteps).toBe(0);
  });
  test('false and indeterminate assertions stop the scene, never silently pass', async () => {
    for (const result of [
      { pass: false, thought: 'Quantity mismatch' },
      undefined,
      { pass: 'true' },
    ]) {
      const runner = new ScenarioRunner(plan());
      const calls: string[] = [];
      await runner.run(async (step) => {
        calls.push(step.id);
        await executeScenarioAgentStep(step, async () => result);
      });
      expect(calls).toEqual(['a']);
      expect(runner.state.status).toBe(
        result?.pass === false ? 'failed' : 'blocked',
      );
      expect(runner.state.scripts[1].status).toBe('pending');
    }
  });
  test('accepts a genuine positive assertion and rejects invalid plans', async () => {
    const runner = new ScenarioRunner(plan());
    await runner.run((step) =>
      executeScenarioAgentStep(step, async () => ({ pass: true })),
    );
    expect(runner.state.status).toBe('completed');
    const input = plan();
    input.scripts.push(input.scripts[0]);
    expect(() => validateScenarioRun(input)).toThrow();
    expect(() =>
      validateScenarioRun({ scenarioId: 'scene', scripts: [] }),
    ).toThrow();
  });
});
