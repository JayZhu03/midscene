import {
  type ScenarioAgentPlan,
  scenarioAgentWaitPlan,
  scenarioAssertionNeedsPlanning,
  validateScenarioAgentPlan,
} from '@midscene/playground';
import { type ScenarioScriptStep, agentTaskStep } from './script-model';

export async function compileStudioAgentPlan(
  instruction: string,
  readOnly: boolean,
  serverUrl: string | null,
  signal: AbortSignal,
): Promise<ScenarioAgentPlan> {
  signal.throwIfAborted();
  const wait = scenarioAgentWaitPlan(instruction, readOnly);
  if (wait) return wait;
  if (!serverUrl)
    throw new Error('Connect a page before preparing Agent steps.');
  const response = await fetch(
    `${serverUrl.replace(/\/$/, '')}/scenario-agent-tasks/compile`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction, readOnly }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(65000)]),
    },
  );
  const body = await response.json();
  signal.throwIfAborted();
  if (!response.ok)
    throw new Error(
      body.error ||
        'Unable to interpret Agent instructions. Please rephrase and retry.',
    );
  return validateScenarioAgentPlan(body.plan, instruction, readOnly);
}

/** Keep recorded native operations and unchanged legacy instructions intact. */
export async function prepareScenarioAgentSteps(
  steps: ScenarioScriptStep[],
  original: ScenarioScriptStep[] | undefined,
  compile: (
    instruction: string,
    readOnly: boolean,
  ) => Promise<ScenarioAgentPlan>,
): Promise<ScenarioScriptStep[]> {
  const before = new Map(original?.map((step) => [step.id, step]));
  const result: ScenarioScriptStep[] = [];
  for (const step of steps) {
    if (step.type === 'playwright-operation') {
      result.push(step);
      continue;
    }
    if (!step.instruction.trim())
      throw new Error('Please enter a step instruction.');
    if (step.type === 'agent-task' && step.agentPlan) {
      validateScenarioAgentPlan(step.agentPlan, step.instruction);
      result.push(step);
      continue;
    }
    const previous = before.get(step.id);
    const edited =
      previous &&
      previous.type !== 'playwright-operation' &&
      previous.instruction !== step.instruction;
    const readOnly = step.type === 'agent-assertion' && !edited;
    const wait = scenarioAgentWaitPlan(step.instruction, readOnly);
    if (
      step.type === 'agent-task' ||
      edited ||
      wait ||
      (step.type === 'agent-assertion' &&
        scenarioAssertionNeedsPlanning(step.instruction))
    ) {
      const plan = wait || (await compile(step.instruction, readOnly));
      result.push(
        agentTaskStep(
          step,
          step.instruction,
          validateScenarioAgentPlan(plan, step.instruction, readOnly),
        ),
      );
    } else result.push(step);
  }
  return result;
}
