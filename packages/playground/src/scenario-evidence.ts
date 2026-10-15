import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Agent,
  ExecutionDump,
  type ExecutionTask,
  type LocateResultElement,
  ReportGenerator,
  ScreenshotItem,
} from '@midscene/core';
import { imageInfoOfBase64 } from '@midscene/shared/img';
import type { Locator, Page } from 'playwright-core';
import type { ScenarioRunState, ScenarioRunStep } from './scenario-contract';
import { isScenarioNavigationObservation } from './scenario-navigation';
import { scenarioReportDescription } from './scenario-report-language';

function isInputModeChange(step: ScenarioRunStep) {
  const event = step.event;
  if (event?.type !== 'keydown' || !event.value) return false;
  return event.value
    .split('+')
    .every((key) =>
      [
        'CapsLock',
        'Shift',
        'Control',
        'Alt',
        'Meta',
        'Process',
        'Dead',
        'Unidentified',
      ].includes(key),
    );
}

function isTextEdit(step: ScenarioRunStep) {
  const event = step.event;
  if (event?.type === 'input') return true;
  if (event?.type !== 'keydown') return false;
  if (
    !event.nativeTarget?.editable &&
    !event.nativeTarget?.selection &&
    !event.nativeTarget?.contentEditableSelection
  )
    return false;
  if (isInputModeChange(step)) return true;
  let key = event.value || '';
  const modifiers: string[] = [];
  while (true) {
    const modifier = /^(Control|Meta|Shift)\+/.exec(key);
    if (!modifier) break;
    modifiers.push(modifier[1]);
    key = key.slice(modifier[0].length);
  }
  // Case changes and same-field selection/editing belong to one input result.
  // Submit, focus changes, dropdown navigation and other shortcuts stay separate.
  return (
    ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
      key,
    ) ||
    (modifiers.every((modifier) => modifier === 'Shift') && key.length === 1) ||
    (modifiers.some((modifier) => modifier !== 'Shift') &&
      ['a', 'c', 'v', 'x', 'y', 'z'].includes(key.toLowerCase()))
  );
}

/** Only merge consecutive edits to the same known field. Never merge clicks. */
export function endsNativeEvidenceBlock(
  steps: ScenarioRunStep[],
  index: number,
) {
  const step = steps[index];
  if (step.type !== 'playwright-operation') return false;
  if (isScenarioNavigationObservation(step)) return false;
  if (!isTextEdit(step)) return true;
  const next = steps
    .slice(index + 1)
    .find((item) => !isScenarioNavigationObservation(item));
  const locator = step.event?.nativeTarget?.locator;
  return !(
    next &&
    next.type === 'playwright-operation' &&
    isTextEdit(next) &&
    locator &&
    step.event?.url === next.event?.url &&
    JSON.stringify(locator) ===
      JSON.stringify(next.event?.nativeTarget?.locator)
  );
}

/** Separate per-run official report; never reuse the active Agent's old report. */
export class ScenarioEvidence {
  private removeListener?: () => void;
  private generator?: ReportGenerator;
  private pending = Promise.resolve();
  private context?: { scriptIndex: number; stepIds: string[]; label: string };
  private nativeSteps: ScenarioRunStep[] = [];
  private nativeScript = -1;
  private nativeStartedAt = 0;
  private nativeBefore?: ScreenshotItem;
  private nativeClick?: LocateResultElement;
  private nativeTarget?: Locator;
  private pointerStep?: string;
  private readonly pointerBinding =
    `__studioReportPointer_${randomUUID().replaceAll('-', '')}`;
  private boundPages = new WeakSet<Page>();
  error?: string;

  constructor(
    private readonly directory: string,
    private readonly run: ScenarioRunState,
    private readonly captureNative?: () => Promise<string> | undefined,
  ) {}

  /** Observe actual dispatched pointer coordinates; never reuse recording coordinates. */
  async beforeNativeAction(page: Page, target: Locator, step: ScenarioRunStep) {
    this.nativeTarget = target;
    if (step.event?.type !== 'click') return;
    this.nativeBefore = undefined;
    this.nativeClick = undefined;
    this.pointerStep = step.id;
    try {
      if (!this.boundPages.has(page)) {
        await page.exposeBinding(
          this.pointerBinding,
          (_source, id: string, point: LocateResultElement) => {
            if (id === this.pointerStep) this.nativeClick = point;
          },
        );
        this.boundPages.add(page);
      }
      await target.scrollIntoViewIfNeeded({ timeout: 3000 });
      this.nativeBefore = await this.nativeScreenshot(page);
      await target.evaluate(
        (element, { binding, id, description }) => {
          element.addEventListener(
            'pointerdown',
            (event) => {
              const pointer = event as PointerEvent;
              const rect = element.getBoundingClientRect();
              void (window as any)
                [binding](id, {
                  center: [pointer.clientX, pointer.clientY],
                  rect: {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                  },
                  description,
                })
                .catch(() => {});
            },
            { once: true, capture: true },
          );
        },
        {
          binding: this.pointerBinding,
          id: step.id,
          description: step.description,
        },
      );
    } catch {
      this.error = '部分点击过程证据未能保存。';
    }
  }

  private async nativeScreenshot(page: Page) {
    const nativeCapture = this.captureNative?.();
    if (nativeCapture) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const nativeImage = await Promise.race([
          nativeCapture,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Native report screenshot timed out')),
              3000,
            );
          }),
        ]);
        return ScreenshotItem.create(nativeImage, Date.now());
      } finally {
        clearTimeout(timer);
      }
    }
    const bytes = await page.screenshot({
      type: 'png',
      scale: 'css',
      timeout: 3000,
    });
    return ScreenshotItem.create(
      `data:image/png;base64,${bytes.toString('base64')}`,
      Date.now(),
    );
  }

  setStep(step: ScenarioRunStep, scriptIndex: number, stepIndex: number) {
    this.nativeBefore = undefined;
    this.nativeClick = undefined;
    this.pointerStep = undefined;
    if (this.nativeScript !== scriptIndex) {
      this.nativeSteps = [];
      this.nativeScript = scriptIndex;
    }
    // IME mode notifications may not dispatch an action. Keep the actual field
    // until the input block ends, so its final value can still be read.
    if (!this.nativeSteps.length) this.nativeTarget = undefined;
    this.context = {
      scriptIndex,
      stepIds: [step.id],
      label: `${this.run.scripts[scriptIndex]?.name || `S${scriptIndex + 1}`} · ${this.run.language === 'en' ? 'Step' : '步骤'} ${stepIndex + 1} · ${scenarioReportDescription(step.description, this.run.language)}`,
    };
    if (
      step.type === 'playwright-operation' &&
      !isScenarioNavigationObservation(step)
    ) {
      if (!this.nativeSteps.length) this.nativeStartedAt = Date.now();
      this.nativeSteps.push(step);
    }
  }

  async recordNativeOutcome(
    agent: Agent,
    step: ScenarioRunStep,
    scriptIndex: number,
    page?: Page,
  ) {
    if (!this.nativeSteps.length) return;
    const steps = this.nativeSteps;
    this.nativeSteps = [];
    const reportStep =
      steps.filter((item) => !isInputModeChange(item)).at(-1) || step;
    const input = steps.some(
      (item) => isTextEdit(item) && !isInputModeChange(item),
    );
    const results = this.run.scripts[scriptIndex]?.steps || [];
    const first = results.findIndex((item) => item.id === steps[0].id) + 1;
    const last = results.findIndex((item) => item.id === steps.at(-1)!.id) + 1;
    const range = first === last ? `${first}` : `${first}–${last}`;
    this.context = {
      scriptIndex,
      stepIds: steps.map((item) => item.id),
      label: `${this.run.scripts[scriptIndex]?.name || `S${scriptIndex + 1}`} · ${this.run.language === 'en' ? 'Steps' : '步骤'} ${range} · ${scenarioReportDescription(reportStep.description, this.run.language)}`,
    };
    if (page && this.generator) {
      try {
        const after = await this.nativeScreenshot(page);
        const before = this.nativeBefore;
        const dimensions = await imageInfoOfBase64((before || after).base64);
        const inputValue =
          input && this.nativeTarget
            ? await this.nativeTarget
                .evaluate((el) =>
                  'value' in el
                    ? String((el as HTMLInputElement).value)
                    : el.textContent || '',
                )
                .catch(() => undefined)
            : undefined;
        const now = Date.now();
        const task: ExecutionTask = {
          taskId: randomUUID(),
          type: 'Action Space',
          subType: input
            ? 'Input'
            : step.event?.actionType ||
              {
                click: 'Tap',
                scroll: 'Scroll',
                keydown: 'KeyboardPress',
                navigation: 'Navigate',
                drag: 'Drag',
                setViewport: 'SetViewport',
                input: 'Input',
              }[step.event!.type],
          status: 'finished',
          executor: () => {},
          hitBy: { from: 'Playwright', context: {} },
          param: {
            locate: {
              prompt: this.context.label,
              ...(before && this.nativeClick ? this.nativeClick : {}),
            },
            ...(inputValue !== undefined ? { value: inputValue } : {}),
          },
          uiContext: {
            screenshot: before || after,
            shotSize: { width: dimensions.width, height: dimensions.height },
            shrunkShotToLogicalRatio: 1,
          },
          recorder: [{ type: 'screenshot', ts: now, screenshot: after }],
          timing: {
            start: this.nativeStartedAt,
            end: now,
            cost: now - this.nativeStartedAt,
          },
        };
        this.enqueue(
          agent,
          new ExecutionDump({
            id: randomUUID(),
            logTime: task.timing!.start,
            name: this.context.label,
            tasks: [task],
          }),
        );
        await this.flush();
      } catch {
        this.error = '部分执行过程证据未能保存。';
      }
      return;
    }
    await this.record(
      agent,
      reportStep,
      this.run.language === 'en' ? 'Result' : '操作结果',
    );
  }

  async attach(agent: Agent) {
    if (!agent.addDumpUpdateListener) return;
    await mkdir(this.directory, { recursive: true });
    this.generator = new ReportGenerator({
      reportPath: join(this.directory, `${this.run.id}.evidence.html`),
      screenshotMode: 'inline',
      autoPrint: false,
    });
    this.removeListener = agent.addDumpUpdateListener(
      (_dump: string, execution?: ExecutionDump) => {
        if (execution) this.enqueue(agent, execution);
      },
    );
  }

  private enqueue(agent: Agent, execution: ExecutionDump) {
    if (!execution || !this.generator) return;
    const dump = agent.dump;
    const context = this.context
      ? { ...this.context, stepIds: [...this.context.stepIds] }
      : undefined;
    this.pending = this.pending
      .then(async () => {
        // Public recordToReport logs lack dimensions, but the official player
        // requires them even for a run containing only native operations.
        // Enrich a report-only copy from the actual image, never the Agent's
        // live perception context or a possibly changed viewport.
        const tasks = await Promise.all(
          execution.tasks.map(async (task) => {
            if (task.uiContext || task.type !== 'Log') return task;
            const screenshot = task.recorder?.find(
              (item) => item.type === 'screenshot',
            )?.screenshot;
            if (!screenshot) return task;
            const { width, height } = await imageInfoOfBase64(
              screenshot.base64,
            );
            return {
              ...task,
              uiContext: {
                screenshot,
                shotSize: { width, height },
                shrunkShotToLogicalRatio: 1,
              },
            };
          }),
        );
        const reportExecution =
          context || tasks.some((task, i) => task !== execution.tasks[i])
            ? new ExecutionDump({
                ...execution,
                tasks,
                ...(context
                  ? {
                      name: context.label,
                      description: execution.description,
                    }
                  : {}),
              })
            : execution;
        if (context && tasks[0]?.taskId) {
          this.run.evidenceLinks ??= [];
          if (
            !this.run.evidenceLinks.some(
              (link) => link.taskId === tasks[0].taskId,
            )
          )
            this.run.evidenceLinks.push({
              ...context,
              taskId: tasks[0].taskId,
            });
        }
        this.generator?.onExecutionUpdate(reportExecution, {
          groupName: this.run.scenarioName || this.run.id,
          groupDescription: this.run.scenarioDescription,
          sdkVersion: dump.sdkVersion,
          modelBriefs: dump.modelBriefs,
          deviceType: dump.deviceType,
        });
      })
      .catch(() => {
        this.error = '部分执行过程证据未能保存。';
      });
    // Handle queue rejection immediately; evidence failures do not rerun steps.
    void this.flush();
  }

  async record(
    agent: Agent,
    step: ScenarioRunStep,
    phase: string,
    error?: unknown,
  ) {
    try {
      if (!agent.recordToReport) return;
      const title = `${phase} / ${step.description}`;
      if (error && agent.recordErrorToReport) {
        this.nativeSteps = [];
        await agent.recordErrorToReport(title, { error });
      } else {
        await agent.recordToReport(title, {
          content:
            this.context?.label ||
            scenarioReportDescription(step.description, this.run.language),
        });
      }
    } catch {
      this.error = '部分执行截图未能保存。';
    }
  }

  async flush() {
    try {
      await this.pending;
      await this.generator?.flush();
    } catch {
      this.error = '执行过程证据保存失败。';
    }
  }

  async finish() {
    this.removeListener?.();
    this.removeListener = undefined;
    try {
      await this.pending;
      await this.generator?.finalize();
    } catch {
      this.error = '执行过程证据保存失败。';
    }
    this.generator = undefined;
    if (this.error) this.run.evidenceError = this.error;
  }
}
