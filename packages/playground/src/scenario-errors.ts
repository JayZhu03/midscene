import type { ScenarioAgentTaskResult } from './scenario-agent-plan';

export class ScenarioBlockedError extends Error {
  constructor(
    message: string,
    readonly agentTask?: ScenarioAgentTaskResult,
  ) {
    super(message);
  }
}
export class ScenarioAssertionError extends Error {
  constructor(
    message: string,
    readonly agentTask?: ScenarioAgentTaskResult,
  ) {
    super(message);
  }
}
export class ScenarioFatalError extends Error {}
