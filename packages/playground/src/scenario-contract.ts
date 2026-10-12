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
  sessionMode?: 'current' | 'fresh';
  scenarioName?: string;
  scope?: 'scenario' | 'script';
  language?: 'zh' | 'en';
  scripts: ScenarioRunScript[];
}
export interface ScenarioStepResult {
  id: string;
  type: ScenarioRunStep['type'];
  description: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'stopped';
  startedAt?: number;
  finishedAt?: number;
  detail?: string;
  error?: string;
  recovery?: ScenarioRecovery;
}
export interface ScenarioRecovery {
  status: 'running' | 'recovered' | 'failed' | 'stopped';
  originalError: string;
  startedAt: number;
  finishedAt?: number;
  observation?: string;
  instruction?: string;
  reason?: string;
}
export interface ScenarioContinuation {
  status: 'checking' | 'allowed' | 'blocked' | 'stopped';
  reason?: string;
}
export type ScenarioRunStatus =
  | 'running'
  | 'waiting'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'blocked'
  | 'completed';
export interface ScenarioRunState {
  id: string;
  scenarioId: string;
  sessionMode?: 'current' | 'fresh';
  scenarioName?: string;
  scope?: 'scenario' | 'script';
  language?: 'zh' | 'en';
  startedAt?: number;
  finishedAt?: number;
  summary?: {
    status: 'generating' | 'completed' | 'failed';
    text?: string;
  };
  status: ScenarioRunStatus;
  scriptIndex: number;
  stepIndex: number;
  stepDescription?: string;
  phase?: 'executing' | 'recovering' | 'checking';
  error?: string;
  scripts: Array<{
    id: string;
    name: string;
    status:
      | 'pending'
      | 'running'
      | 'waiting'
      | 'passed'
      | 'failed'
      | 'blocked'
      | 'stopped';
    error?: string;
    continuation?: ScenarioContinuation;
    completedSteps: number;
    totalSteps: number;
    steps?: ScenarioStepResult[];
  }>;
}

export function scenarioRunActive(state?: ScenarioRunState | null): boolean {
  return Boolean(
    state && ['running', 'waiting', 'stopping'].includes(state.status),
  );
}
