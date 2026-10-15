/** Browser-safe, persisted instructions shared by Studio and its executor. */
export type ScenarioAgentAction =
  | { type: 'operation'; instruction: string }
  | {
      type: 'assertion';
      instruction: string;
      onFailure: 'stop' | 'continue';
    }
  | { type: 'wait'; milliseconds: number };

export interface ScenarioAgentPlan {
  version: 1;
  instruction: string;
  readOnly: boolean;
  actions: ScenarioAgentAction[];
}

export interface ScenarioAgentActionResult {
  action: ScenarioAgentAction;
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
}

export interface ScenarioAgentTaskResult {
  actions: ScenarioAgentActionResult[];
}

export const SCENARIO_AGENT_MAX_WAIT_MS = 300000;

export function validateScenarioAgentPlan(
  value: unknown,
  instruction: string,
  readOnly?: boolean,
): ScenarioAgentPlan {
  const fail = (): never => {
    throw new Error('Invalid Agent execution rules.');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const plan = value as ScenarioAgentPlan;
  if (
    plan.version !== 1 ||
    typeof instruction !== 'string' ||
    !instruction.trim() ||
    instruction.length > 100000 ||
    plan.instruction !== instruction ||
    typeof plan.readOnly !== 'boolean' ||
    (readOnly !== undefined && plan.readOnly !== readOnly) ||
    !Array.isArray(plan.actions) ||
    !plan.actions.length ||
    plan.actions.length > 24
  )
    fail();
  let waits = 0;
  const actions = plan.actions.map((action): ScenarioAgentAction => {
    if (!action || typeof action !== 'object') fail();
    if (action.type === 'wait') {
      if (
        !Number.isSafeInteger(action.milliseconds) ||
        action.milliseconds < 0 ||
        action.milliseconds > SCENARIO_AGENT_MAX_WAIT_MS
      )
        fail();
      waits += action.milliseconds;
      return { type: 'wait', milliseconds: action.milliseconds };
    }
    if (
      !['operation', 'assertion'].includes(action.type) ||
      !('instruction' in action) ||
      typeof action.instruction !== 'string' ||
      !action.instruction.trim() ||
      action.instruction.length > 100000
    )
      fail();
    if (action.type === 'operation') {
      if (plan.readOnly) fail();
      return { type: 'operation', instruction: action.instruction };
    }
    if (action.type !== 'assertion') return fail();
    if (!['stop', 'continue'].includes(action.onFailure)) fail();
    return {
      type: 'assertion',
      instruction: action.instruction,
      onFailure: action.onFailure,
    };
  });
  if (waits > SCENARIO_AGENT_MAX_WAIT_MS) fail();
  return {
    version: 1,
    instruction,
    readOnly: plan.readOnly,
    actions,
  };
}

/** Only recognize an entire, unambiguous wait request; never consume a check. */
export function scenarioAgentWaitPlan(
  instruction: string,
  readOnly = false,
): ScenarioAgentPlan | undefined {
  const text = instruction.trim();
  const number = '(\\d+(?:\\.\\d+)?|[零一二两三四五六七八九十半]+)';
  const zh = text.match(
    new RegExp(
      `^(?:请|先)?\\s*(?:等待|等候|等|暂停|停留)?\\s*${number}\\s*(毫秒|秒钟?|分钟?)\\s*(?:后)?\\s*(?:(?:再|然后|之后|接着)?\\s*(?:继续|执行|运行|开始)(?:执行|运行)?\\s*(?:下一[步条个项])?(?:脚本|步骤|操作|任务)?(?:的执行)?)?[。！.!]?$`,
    ),
  );
  const en = text.match(
    /^(?:please\s+)?(?:wait|pause|sleep)(?:\s+for)?\s+(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|s|minutes?|min)(?:\s*(?:,|and|then)?\s*(?:then\s+)?(?:continue|run|execute)(?:\s+(?:the\s+)?next\s+(?:step|script|operation))?)?[.!]?$/i,
  );
  const match = zh || en;
  if (!match) return;
  const chinese = (value: string): number => {
    if (value === '半') return 0.5;
    const digit = (s: string) =>
      '零一二三四五六七八九'.indexOf(s === '两' ? '二' : s);
    if (value.includes('十')) {
      const parts = value.split('十');
      if (parts.length !== 2 || parts.some((s) => s.length > 1))
        return Number.NaN;
      return (
        (parts[0] ? digit(parts[0]) : 1) * 10 + (parts[1] ? digit(parts[1]) : 0)
      );
    }
    return value.length === 1 ? digit(value) : Number.NaN;
  };
  const amount = /^\d/.test(match[1]) ? Number(match[1]) : chinese(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = /^(毫秒|ms|millisecond)/.test(unit)
    ? 1
    : /^(分|min)/.test(unit)
      ? 60000
      : 1000;
  return validateScenarioAgentPlan(
    {
      version: 1,
      instruction,
      readOnly,
      actions: [{ type: 'wait', milliseconds: amount * multiplier }],
    },
    instruction,
    readOnly,
  );
}

/** Legacy assertions need planning only when they also describe flow control. */
export function scenarioAssertionNeedsPlanning(instruction: string) {
  return /继续|下一[步条个]|等待|暂停|\d+\s*(?:秒|分钟)|[一二两三四五六七八九十半]+秒|\b(?:continue|wait|pause|sleep|next\s+(?:step|script))\b/i.test(
    instruction,
  );
}

export function scenarioAgentTaskCode(plan: ScenarioAgentPlan): string {
  return `await executeScenarioAgentTask(${JSON.stringify(plan, null, 2)}, tools, signal);`;
}

export function scenarioAssertionResults(step: {
  type: string;
  instruction?: string;
  status: string;
  detail?: string;
  error?: string;
  agentTask?: ScenarioAgentTaskResult;
}) {
  if (step.type === 'agent-task')
    return (step.agentTask?.actions || []).flatMap((result) =>
      result.action.type === 'assertion'
        ? [
            {
              instruction: result.action.instruction,
              status: result.status,
              detail: result.detail,
            },
          ]
        : [],
    );
  return step.type === 'agent-assertion'
    ? [
        {
          instruction: step.instruction || '',
          status: step.status,
          detail: step.error || step.detail,
        },
      ]
    : [];
}
