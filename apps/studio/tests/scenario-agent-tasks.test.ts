import {
  type ScenarioAgentPlan,
  scenarioAgentTaskCode,
} from '@midscene/playground';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compileStudioAgentPlan,
  prepareScenarioAgentSteps,
} from '../src/renderer/components/StudioScenarios/agent-tasks';
import {
  agentStepInstruction,
  compileScenarioScript,
  createAgentStep,
  editScenarioScript,
  validateScenarioScript,
} from '../src/renderer/components/StudioScenarios/script-model';
import { buildScenarioRun } from '../src/renderer/components/StudioScenarios/sequence';
import { scenarioSession } from './fixtures/scenario-script';

const signal = () => new AbortController().signal;
const savedPlan = (
  instruction: string,
  readOnly: boolean,
): ScenarioAgentPlan => ({
  version: 1,
  instruction,
  readOnly,
  actions: [
    { type: 'assertion', instruction: '数量为2165', onFailure: 'continue' },
  ],
});
afterEach(() => vi.unstubAllGlobals());

describe('Agent step preparation', () => {
  it('uses no network for a pure wait, and validates every response against the original instruction', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(
      (
        await compileStudioAgentPlan(
          '三秒后再执行下一步脚本',
          false,
          null,
          signal(),
        )
      ).actions,
    ).toEqual([{ type: 'wait', milliseconds: 3000 }]);
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      compileStudioAgentPlan('检查数量', false, null, signal()),
    ).rejects.toThrow('Connect a page');
    const instruction = '检查数量，不对也继续';
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ plan: savedPlan(instruction, false) }),
    });
    expect(
      await compileStudioAgentPlan(
        instruction,
        false,
        'http://localhost:6198/',
        signal(),
      ),
    ).toEqual(savedPlan(instruction, false));
    expect(fetch.mock.calls[0][0]).toBe(
      'http://localhost:6198/scenario-agent-tasks/compile',
    );
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ plan: savedPlan('旧的需求', false) }),
    });
    await expect(
      compileStudioAgentPlan(
        instruction,
        false,
        'http://localhost:6198',
        signal(),
      ),
    ).rejects.toThrow('Invalid Agent');
    fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: '模型连接失败' }),
    });
    await expect(
      compileStudioAgentPlan(
        instruction,
        false,
        'http://localhost:6198',
        signal(),
      ),
    ).rejects.toThrow('模型连接失败');
  });
  it('preserves untouched native and legacy steps and compiles changed/new instructions into one task type', async () => {
    const recorded = compileScenarioScript({
      scenarioId: 's',
      name: '订单',
      session: scenarioSession(),
    });
    const legacy = agentStepInstruction(
      createAgentStep('agent-operation'),
      '打开查询页',
    );
    const assertion = agentStepInstruction(
      createAgentStep('agent-assertion'),
      '数量为2165',
    );
    const steps = [...recorded.steps, legacy, assertion];
    const compile = vi.fn(async (instruction: string, readOnly: boolean) =>
      savedPlan(instruction, readOnly),
    );
    expect(await prepareScenarioAgentSteps(steps, steps, compile)).toEqual(
      steps,
    );
    expect(compile).not.toHaveBeenCalled();
    const edited = [
      steps[0],
      agentStepInstruction(legacy, '检查数量，不对也继续'),
      assertion,
      agentStepInstruction(createAgentStep('agent-task'), '帮我判断数量'),
    ];
    const prepared = await prepareScenarioAgentSteps(edited, steps, compile);
    expect(prepared.map((step) => step.type)).toEqual([
      'playwright-operation',
      'agent-task',
      'agent-assertion',
      'agent-task',
    ]);
    expect(prepared[0]).toBe(steps[0]);
    expect(compile.mock.calls.map((args) => args[1])).toEqual([false, false]);
    const frozen = editScenarioScript(recorded, prepared);
    expect(validateScenarioScript(JSON.parse(JSON.stringify(frozen)))).toEqual(
      frozen,
    );
    compile.mockClear();
    expect(
      await prepareScenarioAgentSteps(frozen.steps, frozen.steps, compile),
    ).toEqual(frozen.steps);
    expect(compile).not.toHaveBeenCalled();
    const run = buildScenarioRun(
      's',
      [frozen],
      [{ id: frozen.id, startMode: 'automatic' }],
    );
    expect(run.scripts[0].steps[1]).toMatchObject({
      type: 'agent-task',
      agentPlan: savedPlan('检查数量，不对也继续', false),
    });
    const changed = agentStepInstruction(prepared[1], '数量为2000，不对继续');
    expect(changed).not.toHaveProperty('agentPlan');
    expect(changed.code).toBe('');
  });
  it('keeps recording assertions read-only while supporting their continue and wait requests', async () => {
    const recorded = compileScenarioScript({
      scenarioId: 's',
      name: '订单',
      session: scenarioSession({
        checkpoints: [
          {
            id: 'count',
            instruction: '数量为2165，不对记录下来也继续',
            timestamp: 2,
            afterEventHashIds: ['event-1'],
          },
        ],
      }),
    });
    const compile = vi.fn(async (instruction: string, readOnly: boolean) =>
      savedPlan(instruction, readOnly),
    );
    const prepared = await prepareScenarioAgentSteps(
      recorded.steps,
      undefined,
      compile,
    );
    expect(compile).toHaveBeenCalledWith(
      '数量为2165，不对记录下来也继续',
      true,
    );
    expect(prepared[1]).toMatchObject({
      type: 'agent-task',
      sourceCheckpoint: recorded.sourceSession.checkpoints![0],
      agentPlan: { readOnly: true },
    });
    expect(prepared[1].code).toBe(
      scenarioAgentTaskCode(savedPlan('数量为2165，不对记录下来也继续', true)),
    );
    const invalid = vi.fn(async (instruction: string) => ({
      ...savedPlan(instruction, true),
      actions: [{ type: 'operation' as const, instruction: '点击查询' }],
    }));
    await expect(
      prepareScenarioAgentSteps(recorded.steps, undefined, invalid),
    ).rejects.toThrow();
    expect(recorded.steps[1].type).toBe('agent-assertion');
  });
  it('does not rewrite or silently save a task when planning fails', async () => {
    const step = agentStepInstruction(
      createAgentStep('agent-task'),
      '检查数量然后继续',
    );
    const before = structuredClone(step);
    await expect(
      prepareScenarioAgentSteps([step], undefined, async () => {
        throw new Error('模型连接失败');
      }),
    ).rejects.toThrow('模型连接失败');
    expect(step).toEqual(before);
  });
});
