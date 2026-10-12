import { readFileSync } from 'node:fs';
import * as fsActual from 'node:fs' with { rstest: 'importActual' };
import type { ModelRuntime } from '@midscene/core/ai-model';
import { beforeEach, describe, expect, rs, test } from '@rstest/core';
import {
  ScenarioRunner,
  executeScenarioAgentStep,
} from '../../src/scenario-runner';
import {
  generateScenarioSummary,
  loadScenarioReportSkill,
  parseScenarioReportAnalysis,
  scenarioSummaryEvidence,
} from '../../src/scenario-summary';

beforeEach(() => {
  rs.mocked(readFileSync).mockImplementation(fsActual.readFileSync);
});

const analysis = {
  overview: '订单检查未通过，需人工核实。',
  findings: [
    {
      scriptIndex: 0,
      stepIndex: 0,
      category: 'assertion',
      certainty: 'confirmed',
      evidence: 'Order missing',
      impact: '订单存在性未通过验证。',
      recommendation: '核对创建结果和查询条件。',
    },
  ],
  limitations: [],
};

describe('execution evidence', () => {
  const failedRun = async () => {
    const runner = new ScenarioRunner({
      scenarioId: 's',
      scripts: [
        {
          id: 'a',
          name: 'Orders',
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
    return runner.state;
  };
  test('repairs invalid output once and rejects invented references, counts and missing findings', async () => {
    const run = await failedRun();
    const evidence = scenarioSummaryEvidence(run);
    for (const bad of [
      { ...analysis, total: 999 },
      { ...analysis, findings: [] },
      { ...analysis, findings: [{ ...analysis.findings[0], stepIndex: 99 }] },
      { ...analysis, findings: [analysis.findings[0], analysis.findings[0]] },
      { ...analysis, findings: [{ ...analysis.findings[0], evidence: '' }] },
    ])
      expect(() =>
        parseScenarioReportAnalysis(JSON.stringify(bad), evidence),
      ).toThrow();
    const call = rs
      .fn()
      .mockResolvedValueOnce({ content: 'not JSON' })
      .mockResolvedValueOnce({ content: JSON.stringify(analysis) });
    const progress = rs.fn();
    const result = await generateScenarioSummary(
      run,
      {} as ModelRuntime,
      new AbortController().signal,
      call,
      progress,
    );
    expect(result.status).toBe('completed');
    expect(call).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls.map(([phase]) => phase)).toEqual([
      'preparing',
      'analyzing',
      'validating',
      'repairing',
      'validating',
    ]);
    expect(call.mock.calls[1][0][0].content).toContain('final attempt');
    const invalid = rs.fn(async () => ({ content: '{}' }));
    const fallback = await generateScenarioSummary(
      run,
      {} as ModelRuntime,
      new AbortController().signal,
      invalid,
    );
    expect(invalid).toHaveBeenCalledTimes(2);
    expect(fallback.status).toBe('failed');
  });
  test('does not retry after cancellation', async () => {
    const run = await failedRun();
    const abort = new AbortController();
    const call = rs.fn(async () => {
      abort.abort();
      return { content: '{}' };
    });
    await expect(
      generateScenarioSummary(run, {} as ModelRuntime, abort.signal, call),
    ).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(1);
  });
  test('accepts script-level blockers but does not turn blocked checkpoints into business mismatches', async () => {
    const run = await failedRun();
    run.status = 'blocked';
    run.scripts[0].status = 'blocked';
    run.scripts[0].steps![0].status = 'pending';
    run.scripts[0].continuation = {
      status: 'blocked',
      reason: 'Required order missing',
    };
    const evidence = scenarioSummaryEvidence(run);
    const blocked = {
      ...analysis,
      findings: [
        { ...analysis.findings[0], stepIndex: null, category: 'prerequisite' },
      ],
    };
    expect(
      parseScenarioReportAnalysis(JSON.stringify(blocked), evidence).findings[0]
        .stepIndex,
    ).toBeNull();
    run.scripts[0].steps![0].status = 'blocked';
    expect(() =>
      parseScenarioReportAnalysis(
        JSON.stringify(analysis),
        scenarioSummaryEvidence(run),
      ),
    ).toThrow('failed checkpoint');
  });
  test('prioritizes later failed evidence globally and keeps original step references', async () => {
    const run = await failedRun();
    run.scripts.unshift({
      id: 'normal',
      name: 'Earlier script',
      status: 'passed',
      completedSteps: 100,
      totalSteps: 100,
      steps: Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        type: 'agent-operation',
        description: 'long description'.repeat(50),
        status: 'passed',
      })),
    });
    const evidence = scenarioSummaryEvidence(run);
    expect(evidence.omittedSteps).toBeGreaterThan(0);
    expect(evidence.scripts[1].steps[0].stepIndex).toBe(0);
    expect(evidence.scripts[1].steps[0].error).toBe('Order missing');
  });
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
      content: JSON.stringify(analysis),
    }));
    const signal = new AbortController().signal;
    const runtime = {} as ModelRuntime;
    const text = await generateScenarioSummary(
      runner.state,
      runtime,
      signal,
      call,
    );
    expect(text.status).toBe('completed');
    expect(text.format).toBe('markdown');
    expect(text.text).toContain('## 1. 测试结论');
    expect(text.text).toContain('订单检查未通过');
    expect(loadScenarioReportSkill()).toContain('Version: 2');
    expect(call.mock.calls[0][0][0].content).toContain(
      'Execution report analysis',
    );
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
    const fallback = await generateScenarioSummary(
      runner.state,
      runtime,
      signal,
      async () => ({ content: '' }),
    );
    expect(fallback.status).toBe('failed');
    expect(fallback.text).toContain('AI 分析未生成');
    expect(fallback.text).toContain('Order missing');
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
