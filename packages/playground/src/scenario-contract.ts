import type { MidsceneRecorderEvent } from '@midscene/shared/recorder';

export type ScenarioStartMode = 'automatic' | 'manual';
export interface ScenarioRunStep {
  id: string;
  type: 'playwright-operation' | 'agent-operation' | 'agent-assertion';
  description: string;
  instruction?: string;
  event?: MidsceneRecorderEvent;
  code?: string;
  operationIndex?: number;
}
export interface ScenarioRunScript {
  id: string;
  name: string;
  startMode: ScenarioStartMode;
  steps: ScenarioRunStep[];
}
export interface ScenarioRunInput {
  scenarioId: string;
  scripts: ScenarioRunScript[];
}
export type ScenarioRunStatus =
  | 'running'
  | 'waiting'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'completed';
export interface ScenarioRunState {
  id: string;
  scenarioId: string;
  status: ScenarioRunStatus;
  scriptIndex: number;
  stepIndex: number;
  stepDescription?: string;
  error?: string;
  scripts: Array<{
    id: string;
    name: string;
    status: 'pending' | 'running' | 'waiting' | 'passed' | 'failed' | 'stopped';
    completedSteps: number;
    totalSteps: number;
  }>;
}

export function scenarioRunActive(state?: ScenarioRunState | null): boolean {
  return Boolean(
    state && ['running', 'waiting', 'stopping'].includes(state.status),
  );
}
