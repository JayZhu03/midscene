import { randomUUID } from 'node:crypto';
import { compileRecorderNativePlaywright } from '@midscene/shared/recorder-native';
import {
  type ScenarioRunInput,
  type ScenarioRunState,
  type ScenarioRunStep,
  scenarioRunActive,
} from './scenario-contract';

export async function executeScenarioAgentStep(
  step: ScenarioRunStep,
  execute: (
    type: 'aiAct' | 'aiAssert',
    instruction: string,
  ) => Promise<unknown>,
) {
  const assertion = step.type === 'agent-assertion';
  const result = await execute(
    assertion ? 'aiAssert' : 'aiAct',
    step.instruction!,
  );
  if (assertion && (result as { pass?: boolean })?.pass !== true) {
    throw new Error(
      (result as { thought?: string })?.thought ||
        'The checkpoint did not pass.',
    );
  }
  return {
    detail:
      typeof (result as { thought?: unknown })?.thought === 'string'
        ? (result as { thought: string }).thought
        : undefined,
  };
}

export function validateScenarioRun(value: ScenarioRunInput): ScenarioRunInput {
  if (
    !value ||
    typeof value.scenarioId !== 'string' ||
    !value.scenarioId ||
    !Array.isArray(value.scripts) ||
    !value.scripts.length ||
    value.scripts.length > 500
  ) {
    throw new Error('Invalid scenario execution plan.');
  }
  if (
    (value.sessionMode !== undefined &&
      !['current', 'fresh'].includes(value.sessionMode)) ||
    (value.scenarioName !== undefined &&
      (typeof value.scenarioName !== 'string' ||
        value.scenarioName.length > 200)) ||
    (value.scope !== undefined &&
      !['scenario', 'script'].includes(value.scope)) ||
    (value.language !== undefined && !['zh', 'en'].includes(value.language))
  )
    throw new Error('Invalid scenario execution plan.');
  const ids = new Set<string>();
  for (const script of value.scripts) {
    if (
      !script ||
      typeof script.id !== 'string' ||
      ids.has(script.id) ||
      typeof script.name !== 'string' ||
      !['automatic', 'manual'].includes(script.startMode) ||
      !Array.isArray(script.steps) ||
      !script.steps.length ||
      script.steps.length > 10000
    ) {
      throw new Error('Invalid scenario script.');
    }
    ids.add(script.id);
    for (const step of script.steps) {
      if (
        !step ||
        typeof step.id !== 'string' ||
        typeof step.description !== 'string'
      )
        throw new Error('Invalid scenario step.');
      if (step.type === 'playwright-operation') {
        if (
          !step.event ||
          !Number.isSafeInteger(step.operationIndex) ||
          step.operationIndex! < 0 ||
          (step.code !==
            compileRecorderNativePlaywright({
              events: [step.event],
              platformId: 'web',
              format: 'operation',
              stepOffset: step.operationIndex,
              sensitiveInputs: 'recorded',
              navigationMode: 'scenario',
            }) &&
            step.code !==
              compileRecorderNativePlaywright({
                events: [step.event],
                platformId: 'web',
                format: 'operation',
                stepOffset: step.operationIndex,
                sensitiveInputs: 'recorded',
              }) &&
            step.code !==
              compileRecorderNativePlaywright({
                events: [step.event],
                platformId: 'web',
                format: 'operation',
                stepOffset: step.operationIndex,
              }))
        ) {
          throw new Error(
            'Recorded operation no longer matches its saved script. Re-record this script.',
          );
        }
        if (
          step.event.type === 'navigation' &&
          step.event.url &&
          !/^https?:\/\//i.test(step.event.url)
        )
          throw new Error('Only HTTP and HTTPS pages can be replayed.');
      } else if (
        !['agent-operation', 'agent-assertion'].includes(step.type) ||
        typeof step.instruction !== 'string' ||
        !step.instruction.trim()
      ) {
        throw new Error('Invalid Agent instruction.');
      }
    }
  }
  return structuredClone(value);
}

/** One owner, one sequential loop. Next never starts a second loop. */
export class ScenarioRunner {
  readonly state: ScenarioRunState;
  readonly abort = new AbortController();
  private resume?: () => void;
  private started = false;
  constructor(readonly plan: ScenarioRunInput) {
    this.state = {
      id: randomUUID(),
      scenarioId: plan.scenarioId,
      sessionMode: plan.sessionMode || 'current',
      scenarioName: plan.scenarioName,
      scope: plan.scope,
      language: plan.language,
      startedAt: Date.now(),
      status: 'running',
      scriptIndex: 0,
      stepIndex: 0,
      scripts: plan.scripts.map((s) => ({
        id: s.id,
        name: s.name,
        status: 'pending',
        completedSteps: 0,
        totalSteps: s.steps.length,
        steps: s.steps.map((step) => ({
          id: step.id,
          type: step.type,
          description: step.description,
          status: 'pending',
        })),
      })),
    };
  }
  next(scriptIndex: number) {
    if (
      this.state.status !== 'waiting' ||
      this.state.scriptIndex !== scriptIndex
    )
      throw new Error('This script is not waiting for the next step.');
    this.state.status = 'running';
    this.resume?.();
    this.resume = undefined;
  }
  stop() {
    if (!scenarioRunActive(this.state)) return;
    this.state.status = 'stopping';
    this.abort.abort(new Error('Scenario stopped.'));
    this.resume?.();
    this.resume = undefined;
  }
  async run(
    execute: (
      step: ScenarioRunStep,
      signal: AbortSignal,
      scriptIndex: number,
    ) => Promise<unknown>,
  ) {
    if (this.started) throw new Error('Scenario already started.');
    this.started = true;
    try {
      for (let i = 0; i < this.plan.scripts.length; i++) {
        this.abort.signal.throwIfAborted();
        this.state.scriptIndex = i;
        this.state.stepIndex = 0;
        this.state.stepDescription = undefined;
        const script = this.plan.scripts[i];
        const result = this.state.scripts[i];
        if (i > 0 && script.startMode === 'manual') {
          this.state.status = 'waiting';
          result.status = 'waiting';
          await new Promise<void>((resolve) => {
            this.resume = resolve;
          });
          this.abort.signal.throwIfAborted();
        }
        result.status = 'running';
        for (let j = 0; j < script.steps.length; j++) {
          this.abort.signal.throwIfAborted();
          this.state.stepIndex = j;
          this.state.stepDescription = script.steps[j].description;
          const stepResult = result.steps![j];
          stepResult.status = 'running';
          stepResult.startedAt = Date.now();
          const evidence = await execute(script.steps[j], this.abort.signal, i);
          this.abort.signal.throwIfAborted();
          stepResult.status = 'passed';
          stepResult.finishedAt = Date.now();
          if (
            evidence &&
            typeof evidence === 'object' &&
            'detail' in evidence &&
            typeof evidence.detail === 'string'
          )
            stepResult.detail = evidence.detail;
          result.completedSteps++;
        }
        result.status = 'passed';
      }
      this.state.status = 'completed';
      this.state.stepDescription = undefined;
    } catch (error) {
      const stopped = this.abort.signal.aborted;
      this.state.status = stopped ? 'stopped' : 'failed';
      this.state.scripts[this.state.scriptIndex].status = stopped
        ? 'stopped'
        : 'failed';
      this.state.error = stopped
        ? undefined
        : error instanceof Error
          ? error.message
          : 'Scenario execution failed.';
      const step =
        this.state.scripts[this.state.scriptIndex].steps?.[
          this.state.stepIndex
        ];
      if (step?.status === 'running') {
        step.status = stopped ? 'stopped' : 'failed';
        step.finishedAt = Date.now();
        step.error = this.state.error;
      }
    } finally {
      this.state.finishedAt = Date.now();
    }
  }
}
