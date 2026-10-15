import { randomUUID } from 'node:crypto';
import { compileRecorderNativePlaywright } from '@midscene/shared/recorder-native';
import {
  type ScenarioAgentTools,
  executeScenarioAgentTask,
} from './scenario-agent-execution';
import { validateScenarioAgentPlan } from './scenario-agent-plan';
import {
  type ScenarioRecovery,
  type ScenarioRunInput,
  type ScenarioRunState,
  type ScenarioRunStep,
  scenarioRunActive,
} from './scenario-contract';
import {
  ScenarioAssertionError,
  ScenarioBlockedError,
  ScenarioFatalError,
} from './scenario-errors';
import { scenarioStepPresentation } from './scenario-step-presentation';

export {
  ScenarioAssertionError,
  ScenarioBlockedError,
  ScenarioFatalError,
} from './scenario-errors';

export interface ScenarioFailureContext {
  plan: ScenarioRunInput;
  state: ScenarioRunState;
  scriptIndex: number;
  stepIndex: number;
}
export interface ScenarioRecoveryHooks {
  recover(
    context: ScenarioFailureContext,
    evidence: ScenarioRecovery,
    signal: AbortSignal,
  ): Promise<boolean>;
  canContinue(
    context: ScenarioFailureContext,
    signal: AbortSignal,
  ): Promise<{ allowed: boolean; reason: string }>;
}

export async function executeScenarioAgentStep(
  step: ScenarioRunStep,
  execute: (
    type: 'aiAct' | 'aiAssert',
    instruction: string,
  ) => Promise<unknown>,
  options: {
    signal?: AbortSignal;
    beforeOperation?: ScenarioAgentTools['beforeOperation'];
    operationCompleted?: ScenarioAgentTools['operationCompleted'];
    onProgress?: ScenarioAgentTools['onProgress'];
  } = {},
) {
  if (step.type === 'agent-task')
    return executeScenarioAgentTask(
      validateScenarioAgentPlan(step.agentPlan, step.instruction!),
      {
        operate: (instruction) => execute('aiAct', instruction),
        assert: (instruction) => execute('aiAssert', instruction),
        beforeOperation: options.beforeOperation,
        operationCompleted: options.operationCompleted,
        onProgress: options.onProgress,
      },
      options.signal || new AbortController().signal,
    );
  const assertion = step.type === 'agent-assertion';
  const result = await execute(
    assertion ? 'aiAssert' : 'aiAct',
    step.instruction!,
  );
  if (assertion && (result as { pass?: boolean })?.pass !== true) {
    const thought = (result as { thought?: unknown })?.thought;
    if (
      (result as { pass?: unknown })?.pass !== false ||
      typeof thought !== 'string' ||
      !thought.trim()
    ) {
      throw new ScenarioBlockedError('The assertion could not be evaluated.');
    }
    throw new ScenarioAssertionError(thought || 'The checkpoint did not pass.');
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
    (value.platformId !== undefined &&
      !['web', 'android'].includes(value.platformId)) ||
    (value.appPackage !== undefined &&
      (typeof value.appPackage !== 'string' ||
        value.appPackage.length > 255 ||
        !value.appPackage.trim())) ||
    typeof value.scenarioId !== 'string' ||
    !value.scenarioId ||
    !Array.isArray(value.scripts) ||
    !value.scripts.length ||
    value.scripts.length > 500
  ) {
    throw new Error('Invalid scenario execution plan.');
  }
  if (
    (value.scenarioDescription !== undefined &&
      (typeof value.scenarioDescription !== 'string' ||
        value.scenarioDescription.length > 4000)) ||
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
        if (value.platformId === 'android')
          throw new Error(
            'Android scenarios cannot contain Playwright operations.',
          );
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
      } else if (step.type === 'agent-task') {
        step.agentPlan = validateScenarioAgentPlan(
          step.agentPlan,
          step.instruction!,
        );
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
  private resume?: (action: 'next' | 'skip') => void;
  private started = false;
  constructor(readonly plan: ScenarioRunInput) {
    this.state = {
      id: randomUUID(),
      scenarioId: plan.scenarioId,
      sessionMode: plan.sessionMode || 'current',
      platformId: plan.platformId || 'web',
      scenarioName: plan.scenarioName,
      scenarioDescription: plan.scenarioDescription,
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
          instruction: step.instruction,
          presentation: scenarioStepPresentation(step),
          ...(step.type === 'agent-task'
            ? {
                agentTask: {
                  actions: step.agentPlan!.actions.map((action) => ({
                    action,
                    status: 'pending' as const,
                  })),
                },
              }
            : {}),
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
    this.resume?.('next');
    this.resume = undefined;
  }
  skip(scriptIndex: number) {
    if (
      this.state.status !== 'waiting' ||
      this.state.scriptIndex !== scriptIndex
    )
      throw new Error('This script is not waiting for the next step.');
    const result = this.state.scripts[scriptIndex];
    result.status = 'skipped';
    for (const step of result.steps || []) {
      step.status = 'skipped';
      step.finishedAt = Date.now();
      for (const action of step.agentTask?.actions || [])
        action.status = 'skipped';
    }
    this.state.status = 'running';
    this.resume?.('skip');
    this.resume = undefined;
  }
  stop() {
    if (!scenarioRunActive(this.state)) return;
    this.state.status = 'stopping';
    this.abort.abort(new Error('Scenario stopped.'));
    this.resume?.('next');
    this.resume = undefined;
  }
  async run(
    execute: (
      step: ScenarioRunStep,
      signal: AbortSignal,
      scriptIndex: number,
    ) => Promise<unknown>,
    hooks?: ScenarioRecoveryHooks,
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
        result.status = 'running';
        this.state.phase = 'executing';
        if (
          hooks &&
          this.state.scripts
            .slice(0, i)
            .some((s) => ['failed', 'blocked', 'skipped'].includes(s.status))
        ) {
          this.state.phase = 'checking';
          result.continuation = { status: 'checking' };
          try {
            const decision = await hooks.canContinue(
              {
                plan: this.plan,
                state: this.state,
                scriptIndex: i,
                stepIndex: 0,
              },
              this.abort.signal,
            );
            this.abort.signal.throwIfAborted();
            result.continuation = {
              status: decision.allowed === true ? 'allowed' : 'blocked',
              reason: decision.reason,
            };
            if (decision.allowed !== true)
              throw new ScenarioBlockedError(decision.reason);
          } catch (error) {
            if (this.abort.signal.aborted) {
              result.continuation.status = 'stopped';
              throw error;
            }
            const reason =
              error instanceof Error
                ? error.message
                : 'Unable to verify prerequisites.';
            result.continuation = { status: 'blocked', reason };
            throw new ScenarioBlockedError(reason);
          }
        }
        this.state.phase = 'executing';
        if (i > 0 && script.startMode === 'manual') {
          this.state.status = 'waiting';
          result.status = 'waiting';
          const action = await new Promise<'next' | 'skip'>((resolve) => {
            this.resume = resolve;
          });
          this.abort.signal.throwIfAborted();
          if (action === 'skip') continue;
          result.status = 'running';
        }
        for (let j = 0; j < script.steps.length; j++) {
          this.abort.signal.throwIfAborted();
          this.state.stepIndex = j;
          this.state.stepDescription = script.steps[j].description;
          const stepResult = result.steps![j];
          stepResult.status = 'running';
          stepResult.startedAt = Date.now();
          let evidence: unknown;
          try {
            evidence = await execute(script.steps[j], this.abort.signal, i);
          } catch (error) {
            this.abort.signal.throwIfAborted();
            if (
              (error instanceof ScenarioAssertionError ||
                error instanceof ScenarioBlockedError) &&
              error.agentTask
            )
              stepResult.agentTask = error.agentTask;
            if (!hooks || error instanceof ScenarioFatalError) throw error;
            const message =
              error instanceof Error
                ? error.message
                : 'Scenario execution failed.';
            let recovered = false;
            if (
              (script.steps[j].type === 'playwright-operation' ||
                (this.plan.platformId === 'android' &&
                  script.steps[j].type === 'agent-operation')) &&
              !(error instanceof ScenarioBlockedError)
            ) {
              stepResult.recovery = {
                status: 'running',
                originalError: message,
                startedAt: Date.now(),
              };
              this.state.phase = 'recovering';
              try {
                recovered =
                  (await hooks.recover(
                    {
                      plan: this.plan,
                      state: this.state,
                      scriptIndex: i,
                      stepIndex: j,
                    },
                    stepResult.recovery,
                    this.abort.signal,
                  )) === true;
                this.abort.signal.throwIfAborted();
                stepResult.recovery.status = recovered ? 'recovered' : 'failed';
              } catch (recoveryError) {
                stepResult.recovery.status = this.abort.signal.aborted
                  ? 'stopped'
                  : 'failed';
                stepResult.recovery.reason =
                  recoveryError instanceof Error
                    ? recoveryError.message
                    : 'Agent recovery failed.';
                this.abort.signal.throwIfAborted();
              } finally {
                stepResult.recovery.finishedAt = Date.now();
                this.state.phase = 'executing';
              }
            }
            if (!recovered) {
              stepResult.status =
                error instanceof ScenarioBlockedError ? 'blocked' : 'failed';
              stepResult.error = message;
              stepResult.finishedAt = Date.now();
              result.status = stepResult.status;
              result.error = stepResult.recovery?.reason || message;
              // No step skipping inside a broken script. The next script is gated above.
              break;
            }
          }
          this.abort.signal.throwIfAborted();
          if (
            evidence &&
            typeof evidence === 'object' &&
            'agentTask' in evidence
          ) {
            const task = evidence as Awaited<
              ReturnType<typeof executeScenarioAgentTask>
            >;
            stepResult.agentTask = task.agentTask;
            if (task.continuedAfterFailure) {
              stepResult.status = 'failed';
              stepResult.continuedAfterFailure = true;
              stepResult.error = task.agentTask.actions.find(
                (a) => a.status === 'failed',
              )?.detail;
              stepResult.detail = task.detail;
              stepResult.finishedAt = Date.now();
              result.status = 'failed';
              result.error ||= stepResult.error;
              result.completedSteps++;
              continue;
            }
          }
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
        if (result.status === 'running') result.status = 'passed';
      }
      const failures = this.state.scripts.filter(
        (s) => s.status === 'failed' || s.status === 'blocked',
      );
      this.state.status = failures.some((s) => s.status === 'blocked')
        ? 'blocked'
        : failures.length
          ? 'failed'
          : 'completed';
      this.state.error = failures[0]?.error;
      this.state.stepDescription = undefined;
    } catch (error) {
      const stopped = this.abort.signal.aborted;
      this.state.status = stopped
        ? 'stopped'
        : error instanceof ScenarioBlockedError
          ? 'blocked'
          : 'failed';
      const currentScript = this.state.scripts[this.state.scriptIndex];
      if (currentScript.status !== 'skipped')
        currentScript.status = stopped ? 'stopped' : this.state.status;
      this.state.error = stopped
        ? undefined
        : error instanceof Error
          ? error.message
          : 'Scenario execution failed.';
      if (currentScript.status !== 'skipped')
        currentScript.error = this.state.error;
      const step =
        this.state.scripts[this.state.scriptIndex].steps?.[
          this.state.stepIndex
        ];
      if (step?.status === 'running') {
        step.status = stopped ? 'stopped' : this.state.status;
        step.finishedAt = Date.now();
        step.error = this.state.error;
        if (
          (error instanceof ScenarioAssertionError ||
            error instanceof ScenarioBlockedError) &&
          error.agentTask
        )
          step.agentTask = error.agentTask;
      }
    } finally {
      this.state.phase = undefined;
      this.state.finishedAt = Date.now();
    }
  }
}
