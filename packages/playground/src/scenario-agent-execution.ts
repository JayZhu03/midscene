import {
  type ScenarioAgentPlan,
  type ScenarioAgentTaskResult,
  validateScenarioAgentPlan,
} from './scenario-agent-plan';
import {
  ScenarioAssertionError,
  ScenarioBlockedError,
} from './scenario-errors';

export interface ScenarioAgentTools {
  operate(instruction: string, signal: AbortSignal): Promise<unknown>;
  assert(instruction: string, signal: AbortSignal): Promise<unknown>;
  beforeOperation?(instruction: string, observesResult: boolean): Promise<void>;
  operationCompleted?(): void;
  onProgress?(result: ScenarioAgentTaskResult): void;
}

function wait(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Scenario stopped.'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** One execution loop for actions, waits and independently verified assertions. */
export async function executeScenarioAgentTask(
  saved: ScenarioAgentPlan,
  tools: ScenarioAgentTools,
  signal: AbortSignal,
) {
  const plan = validateScenarioAgentPlan(saved, saved.instruction);
  const result: ScenarioAgentTaskResult = {
    actions: plan.actions.map((action) => ({ action, status: 'pending' })),
  };
  const update = () => tools.onProgress?.(structuredClone(result));
  update();
  for (const [index, action] of plan.actions.entries()) {
    signal.throwIfAborted();
    const current = result.actions[index];
    current.status = 'running';
    current.startedAt = Date.now();
    update();
    try {
      if (action.type === 'wait') {
        await wait(action.milliseconds, signal);
      } else if (action.type === 'operation') {
        await tools.beforeOperation?.(
          action.instruction,
          plan.actions.slice(index + 1).some((a) => a.type === 'assertion'),
        );
        signal.throwIfAborted();
        await tools.operate(action.instruction, signal);
        tools.operationCompleted?.();
      } else {
        const answer = await tools.assert(action.instruction, signal);
        signal.throwIfAborted();
        const { pass, thought } = (answer || {}) as {
          pass?: unknown;
          thought?: unknown;
        };
        if (
          typeof pass !== 'boolean' ||
          (pass === false && (typeof thought !== 'string' || !thought.trim()))
        )
          throw new ScenarioBlockedError(
            'The assertion could not be evaluated.',
          );
        if (typeof thought === 'string') current.detail = thought;
        if (!pass) {
          current.status = 'failed';
          current.finishedAt = Date.now();
          update();
          if (action.onFailure !== 'continue')
            throw new ScenarioAssertionError(thought as string, result);
          continue;
        }
      }
      signal.throwIfAborted();
      current.status = 'passed';
    } catch (error) {
      current.status = signal.aborted
        ? 'stopped'
        : error instanceof ScenarioAssertionError
          ? 'failed'
          : 'blocked';
      current.detail =
        error instanceof Error ? error.message : 'Agent execution failed.';
      current.finishedAt = Date.now();
      update();
      signal.throwIfAborted();
      if (error instanceof ScenarioAssertionError)
        throw new ScenarioAssertionError(error.message, result);
      throw new ScenarioBlockedError(current.detail, result);
    }
    current.finishedAt = Date.now();
    update();
  }
  return {
    agentTask: result,
    continuedAfterFailure: result.actions.some((a) => a.status === 'failed'),
    detail:
      result.actions
        .map((a) => a.detail)
        .filter(Boolean)
        .join('\n') || undefined,
  };
}
