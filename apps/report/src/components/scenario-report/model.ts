import type {
  ExecutionDump,
  ExecutionTask,
  ReportActionDump,
} from '@midscene/core';
import {
  type ScenarioRunState,
  type ScenarioStepResult,
  scenarioReportDescription,
} from '@midscene/playground';
import type { PlaywrightTasks } from '../../types';

export function parseScenarioReportDump(content: string): ScenarioRunState {
  const run = JSON.parse(content);
  if (
    !run ||
    typeof run.id !== 'string' ||
    typeof run.status !== 'string' ||
    !Array.isArray(run.scripts) ||
    !run.scripts.every(
      (script: ScenarioRunState['scripts'][number]) =>
        script &&
        typeof script.name === 'string' &&
        typeof script.status === 'string' &&
        (script.steps === undefined ||
          (Array.isArray(script.steps) &&
            script.steps.every(
              (step) =>
                step &&
                typeof step.id === 'string' &&
                typeof step.description === 'string' &&
                typeof step.status === 'string',
            ))),
    ) ||
    (run.summary?.analysis &&
      (typeof run.summary.analysis.overview !== 'string' ||
        !Array.isArray(run.summary.analysis.findings) ||
        !Array.isArray(run.summary.analysis.limitations)))
  )
    throw new Error('Invalid Studio execution report.');
  return run;
}

export interface EvidenceExecution {
  dump: ReportActionDump;
  execution: ExecutionDump;
}

export interface ScenarioDisplayStepGroup {
  indices: number[];
  title: string;
  kind: 'input' | 'action' | 'page-action' | 'navigation' | 'agent';
  page?: string;
  targets: string[];
  evidenceTask?: string;
}

const genericTarget =
  /^(?:target element in |unresolved input field|AI is analyzing element)/i;

/** Labels describe the action, never claim a business result from a click.
 * Old records without target names stay honest about that missing context. */
export function scenarioStepLabel(step: ScenarioStepResult, language?: string) {
  const tr = (zh: string, en: string) => (language === 'en' ? en : zh);
  const text = step.description.trim();
  const contextPage = /\btarget element in (.+)/i.exec(text)?.[1];
  const page = step.presentation?.page || contextPage?.split(/\s+[-–|]\s+/)[0];
  const meaningfulPage =
    page && !/^KMMOM CLOUD$/i.test(page) ? page : undefined;
  if (step.type !== 'playwright-operation')
    return {
      kind: 'agent' as const,
      action: 'agent',
      title: step.instruction || text,
      targets: [],
      page: meaningfulPage,
    };
  const action =
    step.presentation?.action ||
    (/^Input into /i.test(text)
      ? 'input'
      : /^Press /i.test(text)
        ? 'keydown'
        : /^Navigate to /i.test(text)
          ? 'navigation'
          : /^Tap /i.test(text)
            ? 'click'
            : '');
  const recordedTarget = /^(?:Input into |Tap )(.+)/i.exec(text)?.[1];
  const target =
    step.presentation?.target ||
    (recordedTarget && !genericTarget.test(recordedTarget)
      ? recordedTarget
      : undefined);
  const targets = target ? [target] : [];
  const kind =
    action === 'input'
      ? 'input'
      : action === 'navigation'
        ? 'navigation'
        : action === 'click' && !target
          ? 'page-action'
          : 'action';
  let title = scenarioReportDescription(text, language);
  if (action === 'input')
    title = target
      ? tr(`填写“${target}”`, `Fill ${target}`)
      : tr('填写表单', 'Fill form');
  if (action === 'clear')
    title = target
      ? tr(`清空“${target}”`, `Clear ${target}`)
      : tr('清空筛选项', 'Clear filter');
  if (action === 'click')
    title = target
      ? tr(`点击“${target}”`, `Click ${target}`)
      : meaningfulPage
        ? tr(`${meaningfulPage}页面操作`, `Actions on ${meaningfulPage}`)
        : tr('点击页面控件', 'Click page control');
  if (action === 'navigation') title = tr('打开网页', 'Open webpage');
  if (action === 'keydown') {
    const key = /^Press (.+?) on /i.exec(text)?.[1];
    if (key) title = tr(`按下 ${key}`, `Press ${key}`);
  }
  return {
    action,
    kind: kind as ScenarioDisplayStepGroup['kind'],
    title,
    targets,
    page: meaningfulPage,
  };
}

const contextOnly = (step: ScenarioStepResult) =>
  step.presentation?.contextOnly ||
  step.detail ===
    'Observed URL is recording context; no navigation outcome was verified.';
const cleanSuccess = (step: ScenarioStepResult) =>
  step.type === 'playwright-operation' &&
  step.status === 'passed' &&
  !step.recovery;
const groupable = (step: ScenarioStepResult) =>
  step.type === 'playwright-operation' &&
  ['passed', 'pending', 'skipped'].includes(step.status) &&
  !step.recovery;

/** Logical reading groups, separate from immutable execution steps. Input
 * edits/mode switches use explicit evidence links; known editable focus targets
 * and adjacent form fields may join them. Unknown clicks are only summarized
 * as page actions, never renamed to guessed business operations. */
export function scenarioDisplayStepGroups(
  run: ScenarioRunState,
  scriptIndex: number,
) {
  const steps = run.scripts[scriptIndex].steps || [];
  const groups: ScenarioDisplayStepGroup[] = [];
  const shared = new Map<string, string>();
  for (const link of run.evidenceLinks || []) {
    if (link.scriptIndex === scriptIndex && link.stepIds.length > 1) {
      for (const id of link.stepIds) shared.set(id, link.taskId);
    }
  }
  const inputTasks = new Set(
    steps
      .filter(
        (step) =>
          step.presentation?.action === 'input' ||
          /^Input into /i.test(step.description),
      )
      .map((step) => shared.get(step.id))
      .filter(Boolean),
  );
  for (const [index, step] of steps.entries()) {
    const previous = groups.at(-1);
    const evidenceTask = cleanSuccess(step) ? shared.get(step.id) : undefined;
    const label = scenarioStepLabel(step, run.language);
    if (evidenceTask && inputTasks.has(evidenceTask)) label.kind = 'input';
    const prior = previous && steps[previous.indices.at(-1)!];
    const safePair =
      prior &&
      groupable(prior) &&
      groupable(step) &&
      prior.status === step.status;
    const samePage =
      prior &&
      (prior.presentation?.url && step.presentation?.url
        ? prior.presentation.url === step.presentation.url
        : previous?.page === label.page);
    const crossesContext =
      prior &&
      contextOnly(prior) &&
      (!evidenceTask || previous?.evidenceTask !== evidenceTask);
    const focus =
      prior?.presentation?.editable && prior.presentation.action === 'click';
    const forms =
      label.kind === 'input' && (previous?.kind === 'input' || focus);
    if (
      safePair &&
      ((evidenceTask && evidenceTask === previous?.evidenceTask) ||
        contextOnly(step) ||
        (samePage &&
          !crossesContext &&
          (forms ||
            (previous?.kind === 'input' &&
              step.presentation?.editable &&
              step.presentation.action === 'click') ||
            (label.kind === 'page-action' &&
              previous?.kind === 'page-action'))))
    ) {
      previous!.indices.push(index);
      if (label.kind === 'input') {
        previous!.kind = 'input';
        previous!.evidenceTask = evidenceTask;
        previous!.targets = [
          ...new Set([...previous!.targets, ...label.targets]),
        ];
      }
    } else groups.push({ ...label, indices: [index], evidenceTask });
  }
  for (const group of groups) {
    if (group.kind === 'input')
      group.title =
        group.targets.length === 1
          ? run.language === 'en'
            ? `Fill ${group.targets[0]}`
            : `填写“${group.targets[0]}”`
          : run.language === 'en'
            ? 'Fill form'
            : '填写表单';
    if (group.kind === 'input' && group.targets.length === 0 && group.page)
      group.title =
        run.language === 'en'
          ? `Fill form on ${group.page}`
          : `填写${group.page}表单`;
  }
  return groups;
}

export interface ScenarioOperationDetail {
  key: string;
  stepIds: string[];
  action: string;
  target: string;
  value?: string;
  valueKind?: 'final' | 'observed' | 'missing';
  missingTarget?: boolean;
  status: ScenarioStepResult['status'];
  count: number;
}

/** Read actual native input outcomes, not recorded keystrokes or an Agent's
 * requested input. A shared final value belongs to its whole linked edit block;
 * never attribute it to a failed/pending subset or another field/script. */
export function scenarioOperationDetails(
  run: ScenarioRunState,
  scriptIndex: number,
  group: ScenarioDisplayStepGroup,
  resolve: ReturnType<typeof createScenarioEvidenceResolver>,
) {
  const tr = (zh: string, en: string) => (run.language === 'en' ? en : zh);
  const steps = group.indices.map(
    (index) => run.scripts[scriptIndex].steps![index],
  );
  const ids = new Set(steps.map((step) => step.id));
  const links = (run.evidenceLinks || []).filter(
    (link) =>
      link.scriptIndex === scriptIndex &&
      link.stepIds.some((id) => ids.has(id)),
  );
  const rows: ScenarioOperationDetail[] = [];
  const seen = new Set<string>();
  const add = (row: ScenarioOperationDetail) => {
    const prior = rows.at(-1);
    if (
      row.missingTarget &&
      prior?.missingTarget &&
      row.action === prior.action &&
      row.valueKind !== 'final' &&
      row.valueKind !== 'observed' &&
      row.valueKind === prior.valueKind &&
      row.status === prior.status
    ) {
      // Missing old click names/edit values get one honest note, not another
      // wall of indistinguishable low-level events.
      if (row.valueKind !== 'missing') prior.count += row.count;
      prior.stepIds.push(...row.stepIds);
    } else rows.push(row);
  };
  for (const step of steps) {
    if (step.type !== 'playwright-operation' || contextOnly(step)) continue;
    const label = scenarioStepLabel(step, run.language);
    if (
      group.kind === 'input' &&
      step.presentation?.editable &&
      label.action === 'click'
    )
      continue;
    const inputLinks = links.filter((link) => link.stepIds.includes(step.id));
    const nativeInput = inputLinks
      .map((link) => ({
        link,
        task: resolve(link.taskId)?.execution.tasks.find(
          (task) => task.taskId === link.taskId,
        ),
      }))
      .find(
        ({ task }) =>
          task?.subType === 'Input' && task.hitBy?.from === 'Playwright',
      );
    if (label.action === 'input' || (nativeInput && group.kind === 'input')) {
      const key = nativeInput?.link.taskId || step.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const related = nativeInput
        ? steps.filter((item) => nativeInput.link.stepIds.includes(item.id))
        : [step];
      const target = related
        .map((item) => scenarioStepLabel(item, run.language).targets[0])
        .filter(Boolean)
        .at(-1);
      const param = nativeInput?.task?.param;
      const value =
        param && ['string', 'number', 'boolean'].includes(typeof param.value)
          ? String(param.value)
          : undefined;
      const attempted = related.every((item) =>
        ['passed', 'failed', 'blocked', 'stopped'].includes(item.status),
      );
      const hasOutcome =
        attempted &&
        value !== undefined &&
        nativeInput?.task?.status === 'finished' &&
        nativeInput.link.stepIds.every((id) => ids.has(id));
      add({
        key,
        stepIds: related.map((item) => item.id),
        action:
          hasOutcome && value === '' ? tr('清空', 'Clear') : tr('填写', 'Fill'),
        target: target || tr('输入框', 'Input field'),
        missingTarget: !target,
        value: hasOutcome ? value : undefined,
        valueKind: hasOutcome
          ? related.every((item) => item.status === 'passed')
            ? 'final'
            : 'observed'
          : 'missing',
        status: step.status,
        count: 1,
      });
      continue;
    }
    if (
      group.kind === 'input' &&
      label.action === 'keydown' &&
      /^Press (?:CapsLock|Shift|Control|Alt|Meta)\b/i.test(step.description)
    )
      continue;
    const target = label.targets[0];
    if (label.action === 'click' || label.action === 'clear') {
      add({
        key: step.id,
        stepIds: [step.id],
        action:
          label.action === 'clear' ? tr('清空', 'Clear') : tr('点击', 'Click'),
        target: target || tr('控件名称未记录', 'Control name not recorded'),
        missingTarget: !target,
        status: step.status,
        count: 1,
      });
    } else if (label.action === 'navigation') {
      add({
        key: step.id,
        stepIds: [step.id],
        action: tr('打开', 'Open'),
        target:
          step.presentation?.url ||
          /^Navigate to (.+)/i.exec(step.description)?.[1] ||
          tr('网址未记录', 'URL not recorded'),
        status: step.status,
        count: 1,
      });
    } else {
      add({
        key: step.id,
        stepIds: [step.id],
        action: tr('操作', 'Action'),
        target: label.title,
        status: step.status,
        count: 1,
      });
    }
  }
  return rows;
}

export interface ScenarioEvidenceFrame {
  screenshot: {
    base64: string;
    capturedAt?: number;
    id?: string;
    sourceRef?: { id?: string };
  };
  label: string;
  capturedAt?: number;
  stepIds: string[];
  taskId: string;
  phase: 'before' | 'after' | 'observed' | 'failure';
  nativeAction?: string;
  pageSettled?: boolean;
}

/** Lazy index: opening an overview never decodes every screenshot. */
export function createScenarioEvidenceResolver(reports: PlaywrightTasks[]) {
  let tasks: Map<string, EvidenceExecution> | undefined;
  return (taskId: string) => {
    if (!tasks) {
      tasks = new Map();
      for (const report of reports) {
        const dump = report.get();
        for (const execution of dump.executions) {
          for (const task of execution.tasks) {
            if (task.taskId) tasks.set(task.taskId, { dump, execution });
          }
        }
      }
    }
    return tasks.get(taskId);
  };
}

/** Resolve only explicit stepIds/taskId links. Never borrow a nearby screenshot
 * or fall back to a recording image when execution evidence is missing. */
export function scenarioEvidenceFor(
  run: ScenarioRunState,
  scriptIndex: number,
  stepId: string | readonly string[] | undefined,
  resolve: ReturnType<typeof createScenarioEvidenceResolver>,
) {
  const links = (run.evidenceLinks || []).filter(
    (link) =>
      link.scriptIndex === scriptIndex &&
      (!stepId ||
        link.stepIds.some((id) =>
          typeof stepId === 'string' ? id === stepId : stepId.includes(id),
        )),
  );
  const executions = new Map<ExecutionDump, EvidenceExecution>();
  const frames: ScenarioEvidenceFrame[] = [];
  for (const link of links) {
    const resolved = resolve(link.taskId);
    if (!resolved || executions.has(resolved.execution)) continue;
    executions.set(resolved.execution, resolved);
    for (const task of resolved.execution.tasks) {
      // A task may reuse its final image as uiContext (native Input does).
      // Classify it by its recorder phase instead of labelling it "before".
      const seen = new Map<unknown, ScenarioEvidenceFrame>();
      const owners = links
        .filter(
          (item) => resolve(item.taskId)?.execution === resolved.execution,
        )
        .flatMap((item) => item.stepIds);
      const action =
        task.hitBy?.from === 'Playwright' || task.type === 'Action Space';
      const add = (
        screenshot: ScenarioEvidenceFrame['screenshot'] | undefined,
        phase: ScenarioEvidenceFrame['phase'],
        ts?: number,
        label: string = phase,
      ) => {
        if (!screenshot) return;
        const key = screenshot.sourceRef?.id || screenshot.id || screenshot;
        const existing = seen.get(key);
        if (existing) {
          existing.phase = phase;
          existing.label = label;
          existing.pageSettled =
            phase === 'after' ? link.pageSettled : undefined;
          return;
        }
        const frame: ScenarioEvidenceFrame = {
          screenshot,
          phase,
          label,
          nativeAction:
            task.hitBy?.from === 'Playwright' ? task.subType : undefined,
          capturedAt: screenshot.capturedAt ?? ts,
          taskId: task.taskId!,
          stepIds: [...new Set(owners)],
          pageSettled: phase === 'after' ? link.pageSettled : undefined,
        };
        seen.set(key, frame);
        frames.push(frame);
      };
      const phase =
        task.type === 'Log' && task.subType === 'Error'
          ? 'failure'
          : action
            ? 'after'
            : 'observed';
      add(
        task.uiContext?.screenshot,
        action ? 'before' : phase,
        task.timing?.start,
      );
      for (const recorder of task.recorder || []) {
        add(
          recorder.screenshot,
          phase,
          recorder.ts,
          recorder.description || phase,
        );
      }
    }
  }
  // Capture time, not report-write/link order, defines the picture sequence.
  frames.sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
  return {
    links,
    executions: [...executions.values()],
    frames,
    shared: links.some((link) => link.stepIds.length > 1),
    missing: links.length > 0 && links.some((link) => !resolve(link.taskId)),
  };
}

/** Select only the requested operation's own frames. Never substitute the last
 * image from its group when that operation has no evidence. */
export function scenarioFrameIndex(
  frames: ScenarioEvidenceFrame[],
  stepIds: readonly string[],
) {
  const owned = frames.flatMap((frame, index) =>
    frame.stepIds.some((id) => stepIds.includes(id)) ? [index] : [],
  );
  const last = owned.at(-1);
  // A successful click often removes its target (dismiss, submit, navigate).
  // Show the clicked control, just like the official replay's pointer frame.
  // Inputs, assertions, failure scenes and Agent recovery keep their result.
  if (
    last !== undefined &&
    frames[last].phase === 'after' &&
    /^(Tap|Click|DoubleClick)$/i.test(frames[last].nativeAction || '')
  ) {
    const before = owned
      .filter(
        (index) =>
          frames[index].taskId === frames[last].taskId &&
          frames[index].phase === 'before',
      )
      .at(-1);
    if (before !== undefined) return before;
  }
  return (
    owned.filter((index) => frames[index].phase !== 'before').at(-1) ??
    owned.at(-1)
  );
}

export function scenarioGroupFrameIndex(
  frames: ScenarioEvidenceFrame[],
  steps: ScenarioStepResult[],
) {
  const lastAction = steps.filter((step) => !contextOnly(step)).at(-1);
  return scenarioFrameIndex(frames, lastAction ? [lastAction.id] : []);
}

export function scenarioStepForTask(
  run: ScenarioRunState,
  scriptIndex: number,
  taskId: string,
  resolve: ReturnType<typeof createScenarioEvidenceResolver>,
) {
  const execution = resolve(taskId)?.execution;
  if (!execution) return undefined;
  const link = run.evidenceLinks?.find(
    (item) =>
      item.scriptIndex === scriptIndex &&
      resolve(item.taskId)?.execution === execution,
  );
  const stepId = link?.stepIds.at(-1);
  const index = run.scripts[scriptIndex].steps?.findIndex(
    (step) => step.id === stepId,
  );
  return index !== undefined && index >= 0 ? index : undefined;
}

export function scenarioEvidenceDimensions(items: EvidenceExecution[]) {
  for (const item of items) {
    const size = item.execution.tasks.find(
      (task: ExecutionTask) => task.uiContext?.shotSize,
    )?.uiContext?.shotSize;
    if (size?.width && size.height) return size;
  }
  return undefined;
}
