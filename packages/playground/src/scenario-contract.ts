import type { MidsceneRecorderEvent } from '@midscene/shared/recorder';
import type {
  ScenarioAgentPlan,
  ScenarioAgentTaskResult,
} from './scenario-agent-plan';
import type { ScenarioReportAnalysis } from './scenario-report';

export type ScenarioStartMode = 'automatic' | 'manual';
export interface ScenarioRunStep {
  id: string;
  type:
    | 'playwright-operation'
    | 'agent-operation'
    | 'agent-assertion'
    | 'agent-task';
  description: string;
  instruction?: string;
  event?: MidsceneRecorderEvent;
  code?: string;
  operationIndex?: number;
  agentPlan?: ScenarioAgentPlan;
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
  /** Report-only context. Does not change recorded code or execution order. */
  presentation?: ScenarioStepPresentation;
  status:
    | 'pending'
    | 'running'
    | 'passed'
    | 'failed'
    | 'blocked'
    | 'stopped'
    | 'skipped';
  startedAt?: number;
  finishedAt?: number;
  detail?: string;
  error?: string;
  recovery?: ScenarioRecovery;
  agentTask?: ScenarioAgentTaskResult;
  continuedAfterFailure?: boolean;
}
export interface ScenarioStepPresentation {
  action: string;
  target?: string;
  page?: string;
  url?: string;
  editable?: boolean;
  contextOnly?: boolean;
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
    skipped?: number;
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
    format?: 'markdown' | 'html';
    skillVersion?: string;
    storageError?: string;
    analysis?: ScenarioReportAnalysis;
    omittedSteps?: number;
  };
  status: ScenarioRunStatus;
  scriptIndex: number;
  stepIndex: number;
  stepDescription?: string;
  phase?: 'executing' | 'recovering' | 'checking';
  error?: string;
  evidenceError?: string;
  evidenceLinks?: Array<{
    scriptIndex: number;
    stepIds: string[];
    taskId: string;
    label: string;
    pageSettled?: boolean;
  }>;
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
      | 'stopped'
      | 'skipped';
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
