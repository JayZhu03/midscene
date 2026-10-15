import { setTimeout as delay } from 'node:timers/promises';
import type { Agent, UIObservation, UIObserver } from '@midscene/core';
import type { ScenarioRunStep } from './scenario-contract';
import { ScenarioBlockedError } from './scenario-runner';

/** One observation belongs to one operation and its following assertions. */
export class ScenarioObservation {
  private observer?: UIObserver;
  private observation?: UIObservation;
  private operation?: { id: string; description: string; startedAt: number };
  private completedAt = 0;
  private captureError?: string;

  constructor(
    private readonly agent: () => Agent,
    private readonly flushEvidence: () => Promise<void>,
    private readonly settleMs = 1000,
  ) {}

  async begin(step: ScenarioRunStep, signal: AbortSignal) {
    await this.clear();
    signal.throwIfAborted();
    try {
      // Awaiting startObserving captures a baseline BEFORE the operation.
      this.observer = await this.agent().startObserving({
        intervalMs: 200,
        maxFrames: 32,
        watchdogMs: 30000,
      });
      this.operation = {
        id: step.id,
        description: step.description,
        startedAt: Date.now(),
      };
    } catch {
      // Do not turn evidence collection failure into a retry of a mutation.
      this.captureError = '无法采集操作过程画面，断言证据不足。';
    }
    signal.throwIfAborted();
  }

  operationCompleted() {
    this.completedAt = Date.now();
  }

  async assert(step: ScenarioRunStep, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.captureError) throw new ScenarioBlockedError(this.captureError);
    const agent = this.agent();
    if (this.observer && !this.observation) {
      const remaining = this.completedAt + this.settleMs - Date.now();
      if (remaining > 0) await delay(remaining, undefined, { signal });
      try {
        this.observation = await this.observer.stop();
      } catch {
        signal.throwIfAborted();
        throw new ScenarioBlockedError('过程画面读取失败，无法判断断言。');
      }
    }
    signal.throwIfAborted();
    if (this.observation && this.completedAt > this.observation.endedAt) {
      throw new ScenarioBlockedError('操作超出画面观察时限，过程证据不完整。');
    }
    let current: string;
    try {
      current = await agent.interface.screenshotBase64();
    } catch {
      signal.throwIfAborted();
      throw new ScenarioBlockedError('当前页面截图失败，无法判断断言。');
    }
    signal.throwIfAborted();
    const now = Date.now();
    const context = `Evaluate the user's original assertion without changing its meaning.
The explicitly named CURRENT_PAGE image is the current page at ${now}; use it for current state, counts, values and status. Never use a historical frame to override it.
${this.operation && this.observation ? `The observed sequence belongs ONLY to operation ${JSON.stringify(this.operation.description)} (id ${this.operation.id}), started at ${this.operation.startedAt}. The first frame is the BEFORE-action baseline. Observed window: ${this.observation.startedAt} to ${this.observation.endedAt}. For "appeared", "toast" or other event assertions, require evidence of the expected event AFTER that operation. A matching message already present in the baseline is not proof. No evidence outside this bounded sampled window is available.` : 'No preceding operation was observed in this script. Only the current page is available; do not invent past transient events.'}
For assertions combining an event and a final state, BOTH must hold. Do not infer business success from an attempted click. State evidence limits explicitly. Respond in ${step.instruction?.match(/[\u3400-\u9fff]/) ? 'Simplified Chinese' : 'the language of the assertion'}.`;
    const prompt = {
      prompt: step.instruction!,
      images: [{ name: `CURRENT_PAGE at ${now}`, url: current }],
    };
    // Also persist the exact current image, not another screenshot taken later.
    await agent
      .recordToReport?.(`断言当前页面 / ${step.description}`, {
        screenshotBase64: current,
        content: `Captured at ${now}; ${this.operation ? `operation ${this.operation.id}` : 'no preceding operation'}`,
      })
      .catch(() => {
        /* A report write cannot change the assertion result. */
      });
    signal.throwIfAborted();
    const result = await (this.observation || agent).aiAssert(
      prompt,
      undefined,
      {
        keepRawResponse: true,
        abortSignal: signal,
        context: [
          agent.opts?.aiContexts?.aiAssert ?? agent.opts?.aiContexts?.default,
          context,
        ]
          .filter((value) => value !== undefined)
          .join('\n\n'),
      },
    );
    signal.throwIfAborted();
    await this.flushEvidence();
    if (
      !result ||
      typeof result.pass !== 'boolean' ||
      (result.pass === false && !result.thought?.trim())
    ) {
      throw new ScenarioBlockedError(
        '模型未能完成断言，请检查模型服务后重试。',
      );
    }
    return result;
  }

  async clear() {
    // Copy observation-backed screenshots into the official report before
    // releasing the temporary files, including failed assertions/cancellation.
    try {
      await this.flushEvidence();
    } finally {
      try {
        await this.observer?.dispose();
      } finally {
        this.observer = undefined;
        this.observation = undefined;
        this.operation = undefined;
        this.captureError = undefined;
        this.completedAt = 0;
      }
    }
  }
}
