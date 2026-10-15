import type { ModelRuntime } from '@midscene/core/ai-model';
import { describe, expect, rs, test } from '@rstest/core';
import { compileScenarioAgentPlan } from '../../src/scenario-agent-compiler';
import { executeScenarioAgentTask } from '../../src/scenario-agent-execution';
import {
  type ScenarioAgentAction,
  type ScenarioAgentPlan,
  scenarioAgentWaitPlan,
  validateScenarioAgentPlan,
} from '../../src/scenario-agent-plan';
import {
  ScenarioAssertionError,
  ScenarioBlockedError,
} from '../../src/scenario-errors';
import { scenarioOperationPrecedesAssertion } from '../../src/scenario-navigation';
import { renderScenarioHtmlConclusion } from '../../src/scenario-report-html';
import {
  ScenarioRunner,
  executeScenarioAgentStep,
  validateScenarioRun,
} from '../../src/scenario-runner';
import {
  parseScenarioReportAnalysis,
  scenarioSummaryEvidence,
} from '../../src/scenario-summary';

const signal = () => new AbortController().signal;
const plan = (
  actions: ScenarioAgentAction[],
  instruction = '点击查询，判断数量为2165，不对也继续',
): ScenarioAgentPlan => ({
  version: 1,
  instruction,
  readOnly: false,
  actions,
});
const check = (
  onFailure: 'continue' | 'stop' = 'continue',
): ScenarioAgentAction => ({
  type: 'assertion',
  instruction: '数量为2165',
  onFailure,
});
const task = (agentPlan: ScenarioAgentPlan) => ({
  id: 'task',
  type: 'agent-task' as const,
  instruction: agentPlan.instruction,
  description: agentPlan.instruction,
  agentPlan,
});
const tools = () => ({
  operate: rs.fn(async () => {}),
  assert: rs.fn(async () => ({ pass: true, thought: '数量为2165' })),
  beforeOperation: rs.fn(
    async (_instruction: string, _observes: boolean) => {},
  ),
  operationCompleted: rs.fn(),
});

describe('saved Agent plans', () => {
  test('pure waits are deterministic and do not load a model or require a page', async () => {
    for (const [instruction, ms] of [
      ['三秒后再执行下一步脚本', 3000],
      ['等候两秒', 2000],
      ['等待半分钟', 30000],
      ['等待十一秒', 11000],
      ['wait 1.5 seconds then execute next script', 1500],
      ['pause for 200 ms', 200],
    ] as const) {
      const runtime = rs.fn(() => {
        throw new Error('must not load a model');
      });
      const call = rs.fn();
      const saved = await compileScenarioAgentPlan(
        instruction,
        false,
        runtime,
        signal(),
        call,
      );
      expect(saved.actions).toEqual([{ type: 'wait', milliseconds: ms }]);
      expect(runtime).not.toHaveBeenCalled();
      expect(call).not.toHaveBeenCalled();
    }
    expect(
      scenarioAgentWaitPlan('等3秒，判断是否出现保存成功'),
    ).toBeUndefined();
    expect(scenarioAgentWaitPlan('点击等待三秒按钮')).toBeUndefined();
    expect(() => scenarioAgentWaitPlan('wait 301 seconds')).toThrow();
  });
  test('validates immutable instructions, read-only permissions and bounded actions', () => {
    const saved = plan([check()]);
    expect(validateScenarioAgentPlan(saved, saved.instruction)).toEqual(saved);
    for (const invalid of [
      { ...saved, instruction: 'different instruction' },
      { ...saved, actions: [] },
      { ...saved, actions: Array.from({ length: 25 }, () => check()) },
      { ...saved, actions: [{ type: 'wait', milliseconds: -1 }] },
      { ...saved, actions: [{ type: 'wait', milliseconds: 1.5 }] },
      {
        ...saved,
        actions: [
          { type: 'wait', milliseconds: 200000 },
          { type: 'wait', milliseconds: 200000 },
        ],
      },
      { ...saved, actions: [{ ...check(), onFailure: 'pass' }] },
      { ...saved, actions: [{ type: 'code', instruction: 'do anything' }] },
      {
        ...saved,
        readOnly: true,
        actions: [{ type: 'operation', instruction: '点击保存' }],
      },
    ])
      expect(() =>
        validateScenarioAgentPlan(invalid, saved.instruction),
      ).toThrow();
  });
  test('compiles ordered operations and checks once, rejecting invalid or unsupported responses', async () => {
    const actions: ScenarioAgentAction[] = [
      { type: 'operation', instruction: '点击查询' },
      { type: 'wait', milliseconds: 3000 },
      check(),
    ];
    const call = rs.fn().mockResolvedValue({
      content: `\u0060\u0060\u0060json\n${JSON.stringify({ actions })}\n\u0060\u0060\u0060`,
    });
    const runtime = rs.fn(() => ({}) as ModelRuntime);
    const saved = await compileScenarioAgentPlan(
      '点击查询，等三秒，判断数量为2165，不对也继续',
      false,
      runtime,
      signal(),
      call,
    );
    expect(saved.actions).toEqual(actions);
    expect(call).toHaveBeenCalledTimes(1);
    for (const content of [
      'not JSON',
      'null',
      '{"actions":[]}',
      '{"error":"暂不支持循环"}',
      '{"actions":[{"type":"operation","instruction":"点击查询"}]}',
    ]) {
      call.mockResolvedValueOnce({ content });
      await expect(
        compileScenarioAgentPlan('只判断数量', true, runtime, signal(), call),
      ).rejects.toThrow();
    }
    const abort = new AbortController();
    abort.abort();
    await expect(
      compileScenarioAgentPlan('等待三秒', false, runtime, abort.signal, call),
    ).rejects.toThrow();
  });
});

describe('combined operation and assertion execution', () => {
  test('observes before the operation and verifies afterward in one ordered loop', async () => {
    const order: string[] = [];
    const t = tools();
    t.beforeOperation.mockImplementation(async (_instruction, observes) => {
      expect(observes).toBe(true);
      order.push('observe');
    });
    t.operate.mockImplementation(async () => {
      order.push('operate');
    });
    t.operationCompleted.mockImplementation(() => order.push('complete'));
    t.assert.mockImplementation(async () => {
      order.push('check');
      return { pass: true, thought: '2165' };
    });
    const result = await executeScenarioAgentTask(
      plan([
        { type: 'operation', instruction: '点击查询' },
        { type: 'wait', milliseconds: 1 },
        check(),
      ]),
      t,
      signal(),
    );
    expect(order).toEqual(['observe', 'operate', 'complete', 'check']);
    expect(result.agentTask.actions.map((a) => a.status)).toEqual([
      'passed',
      'passed',
      'passed',
    ]);
    expect(result.continuedAfterFailure).toBe(false);
  });
  test('continues after a confirmed mismatch but preserves failure in the step, run, report and next-script gate', async () => {
    const input = validateScenarioRun({
      scenarioId: 'scene',
      language: 'zh',
      scripts: [
        {
          id: 'a',
          name: '查询',
          startMode: 'automatic',
          steps: [
            task(
              plan([check(), { type: 'operation', instruction: '打开详情' }]),
            ),
            {
              id: 'after',
              type: 'agent-operation',
              instruction: '打开制造订单',
              description: '打开制造订单',
            },
          ],
        },
        {
          id: 'b',
          name: '独立查询',
          startMode: 'automatic',
          steps: [
            {
              id: 'next',
              type: 'agent-assertion',
              instruction: '页面可见',
              description: '页面可见',
            },
          ],
        },
      ],
    });
    const run = new ScenarioRunner(input);
    const calls: string[] = [];
    const recover = rs.fn(async () => false);
    const canContinue = rs.fn(async (context) => {
      expect(context.state.scripts[0].steps[0].continuedAfterFailure).toBe(
        true,
      );
      return { allowed: true, reason: '后续查询独立' };
    });
    await run.run(
      (step, abort) =>
        executeScenarioAgentStep(
          step,
          async (type, instruction) => {
            calls.push(`${type}:${instruction}`);
            return {
              pass: instruction !== '数量为2165',
              thought: '实际为2155',
            };
          },
          { signal: abort },
        ),
      { recover, canContinue },
    );
    expect(calls).toEqual([
      'aiAssert:数量为2165',
      'aiAct:打开详情',
      'aiAct:打开制造订单',
      'aiAssert:页面可见',
    ]);
    expect(run.state.status).toBe('failed');
    expect(run.state.scripts[0]).toMatchObject({
      status: 'failed',
      completedSteps: 2,
    });
    expect(run.state.scripts[0].steps![0]).toMatchObject({
      status: 'failed',
      continuedAfterFailure: true,
    });
    expect(run.state.scripts[0].steps![1].status).toBe('passed');
    expect(run.state.scripts[1].status).toBe('passed');
    expect(recover).not.toHaveBeenCalled();
    expect(canContinue).toHaveBeenCalledTimes(1);
    const evidence = scenarioSummaryEvidence(run.state);
    expect(evidence.checkpoints).toMatchObject({
      total: 2,
      failed: 1,
      passed: 1,
    });
    const html = renderScenarioHtmlConclusion(run.state);
    expect(html).toContain('已按要求记录失败并继续执行');
    expect(html).not.toContain('未设置检查点');
    expect(
      parseScenarioReportAnalysis(
        JSON.stringify({
          overview: '数量不符，独立查询继续。',
          limitations: [],
          findings: [
            {
              scriptIndex: 0,
              stepIndex: 0,
              category: 'assertion',
              certainty: 'confirmed',
              evidence: '实际为2155',
              impact: '数量未通过',
              recommendation: '核对数据基线',
            },
          ],
        }),
        evidence,
      ).findings,
    ).toHaveLength(1);
  });
  test('stop-on-mismatch preserves following actions as unexecuted; unknown evidence and failed operations always block', async () => {
    for (const mode of ['stop', 'unknown', 'operation'] as const) {
      const t = tools();
      const saved = plan([
        ...(mode === 'operation'
          ? [{ type: 'operation' as const, instruction: '保存' }]
          : []),
        check(mode === 'stop' ? 'stop' : 'continue'),
        { type: 'operation', instruction: '后续操作' },
      ]);
      if (mode === 'stop')
        t.assert.mockResolvedValue({ pass: false, thought: '实际为2155' });
      if (mode === 'unknown') t.assert.mockResolvedValue({} as never);
      if (mode === 'operation')
        t.operate.mockRejectedValue(new Error('未找到按钮'));
      let caught: unknown;
      try {
        await executeScenarioAgentTask(saved, t, signal());
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(
        mode === 'stop' ? ScenarioAssertionError : ScenarioBlockedError,
      );
      const results = (caught as ScenarioBlockedError).agentTask!.actions;
      expect(results[0].status).toBe(mode === 'stop' ? 'failed' : 'blocked');
      expect(results.at(-1)!.status).toBe('pending');
      expect(t.operate).toHaveBeenCalledTimes(mode === 'operation' ? 1 : 0);
    }
  });
  test('a wait is cancellable and cannot run later actions or call AI', async () => {
    const controller = new AbortController();
    const t = tools();
    let waiting!: () => void;
    const started = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const done = executeScenarioAgentTask(
      plan([{ type: 'wait', milliseconds: 300000 }, check()]),
      {
        ...t,
        onProgress: (result) => {
          if (result.actions[0].status === 'running') waiting();
        },
      },
      controller.signal,
    );
    await started;
    controller.abort(new Error('Stopped'));
    await expect(done).rejects.toThrow('Stopped');
    expect(t.operate).not.toHaveBeenCalled();
    expect(t.assert).not.toHaveBeenCalled();
  });
  test('keeps observation across a pure wait before a combined assertion and preserves manual boundaries', async () => {
    const operation = {
      id: 'op',
      type: 'agent-operation' as const,
      instruction: '退出登录',
      description: '退出登录',
    };
    expect(
      scenarioOperationPrecedesAssertion(
        [
          operation,
          task(plan([{ type: 'wait', milliseconds: 3 }])),
          task(plan([check()])),
        ],
        0,
      ),
    ).toBe(true);
    const input = {
      scenarioId: 's',
      scripts: [
        {
          id: 'a',
          name: 'a',
          startMode: 'automatic' as const,
          steps: [task(plan([{ type: 'wait', milliseconds: 1 }]))],
        },
        {
          id: 'b',
          name: 'b',
          startMode: 'manual' as const,
          steps: [task(plan([check()]))],
        },
      ],
    };
    const run = new ScenarioRunner(input);
    const done = run.run((step, abort) =>
      executeScenarioAgentStep(step, async () => ({ pass: true }), {
        signal: abort,
      }),
    );
    for (let i = 0; i < 50 && run.state.status !== 'waiting'; i++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    expect(run.state.status).toBe('waiting');
    run.skip(1);
    await done;
    expect(scenarioSummaryEvidence(run.state).checkpoints).toMatchObject({
      total: 1,
      skipped: 1,
      passed: 0,
    });
  });
});
