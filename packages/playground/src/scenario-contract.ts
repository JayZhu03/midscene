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
  platformId?: 'web' | 'android';
  appPackage?: string;
  scenarioId: string;
  sessionMode?: 'current' | 'fresh';
  scenarioName?: string;
  scenarioDescription?: string;
  scope?: 'scenario' | 'script';
  language?: 'zh' | 'en';
  scripts: ScenarioRunScript[];
}
export interface ScenarioStepResult {
  id: string;
  type: ScenarioRunStep['type'];
  description: string;
  instruction?: string;
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
  attempts?: Array<{
    strategy: 'wait' | 'act' | 'backtrack';
    reason: string;
    instruction?: string;
    previousStepId?: string;
    error?: string;
    verification?: string;
    completed?: boolean;
  }>;
}
export interface ScenarioContinuation {
  status: 'checking' | 'allowed' | 'blocked' | 'stopped';
  reason?: string;
}
export interface ScenarioReportEntry {
  platformId?: 'web' | 'android';
  id: string;
  name?: string;
  scenarioName?: string;
  scope?: 'scenario' | 'script';
  startedAt?: number;
  finishedAt?: number;
  status: ScenarioRunStatus;
  counts: {
    passed: number;
    failed: number;
    blocked: number;
    pending: number;
    stopped: number;
  };
  recoveryCount: number;
}
export type ScenarioRunStatus =
  | 'running'
  | 'waiting'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'blocked'
  | 'completed';
export type ScenarioReportPhase =
  | 'preparing'
  | 'analyzing'
  | 'validating'
  | 'repairing'
  | 'saving'
  | 'ready';
export interface ScenarioRunState {
  platformId?: 'web' | 'android';
  id: string;
  scenarioId: string;
  sessionMode?: 'current' | 'fresh';
  scenarioName?: string;
  scenarioDescription?: string;
  scope?: 'scenario' | 'script';
  language?: 'zh' | 'en';
  startedAt?: number;
  finishedAt?: number;
  summary?: {
    status: 'generating' | 'completed' | 'failed';
    phase?: ScenarioReportPhase;
    text?: string;
    format?: 'markdown';
    skillVersion?: string;
    storageError?: string;
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
