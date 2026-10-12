import type { ModelRuntime } from '@midscene/core/ai-model';
import { describe, expect, rs, test } from '@rstest/core';
import {
  ScenarioRunner,
  executeScenarioAgentStep,
} from '../../src/scenario-runner';
import {
  generateScenarioSummary,
  scenarioSummaryEvidence,
} from '../../src/scenario-summary';

describe('execution evidence', () => {
  test('calls the model once with execution evidence and cancellation, without changing the verdict', async () => {
    const runner = new ScenarioRunner({
      scenarioId: 's',
      language: 'zh',
      scripts: [
        {
          id: 'a',
          name: 'A',
          startMode: 'automatic',
          steps: [
            {
              id: 'x',
              type: 'agent-assertion',
              instruction: 'Order exists',
              description: 'Order exists',
            },
          ],
        },
      ],
    });
    await runner.run(async () => {
      throw new Error('Order missing');
    });
    const before = structuredClone(runner.state);
    const call = rs.fn(async () => ({
      content: '  订单检查失败，请检查准备数据。  ',
    }));
    const signal = new AbortController().signal;
    const runtime = {} as ModelRuntime;
    const text = await generateScenarioSummary(
      runner.state,
      runtime,
      signal,
      call,
    );
    expect(text).toBe('订单检查失败，请检查准备数据。');
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Order missing'),
        }),
      ]),
      runtime,
      { abortSignal: signal },
    );
    expect(runner.state).toEqual(before);
    await expect(
      generateScenarioSummary(runner.state, runtime, signal, async () => ({
        content: '',
      })),
    ).rejects.toThrow('Empty scenario summary');
  });
  test('retains checkpoint explanations, failures and unexecuted steps', async () => {
    const runner = new ScenarioRunner({
      scenarioId: 's',
      scripts: [
        {
          id: 'a',
          name: 'Orders',
          startMode: 'automatic',
          steps: ['one', 'two', 'three'].map((id) => ({
            id,
            description: id,
            instruction: id,
            type: 'agent-assertion',
          })),
        },
      ],
    });
    await runner.run((step) =>
      executeScenarioAgentStep(step, async () => ({
        pass: step.id === 'one',
        thought: step.id === 'one' ? 'Quantity is 10' : 'Expected 20, found 10',
      })),
    );
    const evidence = scenarioSummaryEvidence(runner.state);
    expect(evidence.status).toBe('failed');
    expect(evidence.checkpoints).toEqual({
      total: 3,
      passed: 1,
      failed: 1,
      blocked: 0,
      unexecuted: 1,
    });
    expect(evidence.scripts[0].steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'one',
          status: 'passed',
          detail: 'Quantity is 10',
        }),
        expect.objectContaining({
          description: 'two',
          status: 'failed',
          error: 'Expected 20, found 10',
        }),
        expect.objectContaining({ description: 'three', status: 'pending' }),
      ]),
    );
    expect(runner.state.finishedAt).toBeGreaterThanOrEqual(
      runner.state.startedAt!,
    );
  });
  test('does not count an interrupted action as passed or invent checkpoints', async () => {
    const runner = new ScenarioRunner({
      scenarioId: 's',
      scripts: [
        {
          id: 'a',
          name: 'A',
          startMode: 'automatic',
          steps: [
            {
              id: 'x',
              type: 'agent-operation',
              description: 'Click save',
              instruction: 'Click save',
            },
          ],
        },
      ],
    });
    await runner.run(async () => {
      runner.stop();
    });
    const evidence = scenarioSummaryEvidence(runner.state);
    expect(evidence.status).toBe('stopped');
    expect(evidence.passedSteps).toBe(0);
    expect(evidence.checkpoints.total).toBe(0);
    expect(evidence.scripts[0].steps[0].status).toBe('stopped');
  });
});
