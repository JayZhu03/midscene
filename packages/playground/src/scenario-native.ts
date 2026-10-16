import { setTimeout as delay } from 'node:timers/promises';
import { getDebug } from '@midscene/shared/logger';
import type { MidsceneRecorderNativeLocator } from '@midscene/shared/recorder';
import {
  recorderNativeGeneratedTextPattern,
  recorderNativeTextPattern,
} from '@midscene/shared/recorder-native';
import { type Locator, type Page, chromium } from 'playwright-core';
import type { ScenarioRunStep } from './scenario-contract';
import { ScenarioBlockedError } from './scenario-errors';
import { rebindScenarioFilterLocator } from './scenario-native-locator';
import {
  type ScenarioNavigationEffect,
  isScenarioTransientUrl,
  sameScenarioPage,
  scenarioLiveNavigationTarget,
  scenarioNavigationExpectation,
  scenarioNavigationMatches,
  scenarioRoute,
} from './scenario-navigation';
import { observeScenarioReadiness } from './scenario-readiness';

const debugScenario = getDebug('scenario:navigation', { console: true });

async function pageDiagnostics(page: Page) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      page
        .evaluate(() => ({
          readyState: document.readyState,
          loadingIndicatorCount: document.querySelectorAll(
            '[aria-busy="true"], [role="progressbar"], .ant-spin-spinning, .el-loading-mask',
          ).length,
        }))
        .catch(() => ({ rendererState: 'unavailable' })),
      new Promise<{ rendererState: string }>((resolve) => {
        timer = setTimeout(
          () => resolve({ rendererState: 'unresponsive' }),
          500,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForScenarioNavigation(
  page: Page,
  effect: ScenarioNavigationEffect,
  signal: AbortSignal,
  waitReady?: (signal: AbortSignal) => Promise<void>,
  timeoutMs = 10000,
  navigationBindings?: Map<string, string>,
) {
  const expectedRoute = scenarioNavigationExpectation(effect).expectedRoute;
  const deadline = Date.now() + timeoutMs;
  while (!scenarioNavigationMatches(effect, page.url())) {
    signal.throwIfAborted();
    if (Date.now() >= deadline) {
      debugScenario('Recorded navigation did not take effect: %o', {
        observationStepId: effect.observationStepId,
        recordedBeforeRoute: scenarioRoute(effect.beforeUrl),
        expectedRoute,
        actualRoute: scenarioRoute(page.url()),
        ...(await pageDiagnostics(page)),
      });
      throw new Error('操作后未切换到预期页面。');
    }
    await delay(100, undefined, { signal });
  }
  signal.throwIfAborted();
  await page.waitForLoadState('domcontentloaded');
  await waitReady?.(signal);
  signal.throwIfAborted();
  // Readiness can outlive another redirect. It must not certify the old route.
  if (!scenarioNavigationMatches(effect, page.url())) {
    debugScenario('Route changed while settling: %o', {
      expectedRoute,
      actualRoute: scenarioRoute(page.url()),
    });
    throw new Error('页面切换后又离开了录制页面。');
  }
  debugScenario('Recorded route transition verified: %o', {
    observationStepId: effect.observationStepId,
    expectedRoute,
    actualRoute: scenarioRoute(page.url()),
  });
  if (
    isScenarioTransientUrl(effect.afterUrl) ||
    scenarioRoute(effect.afterUrl) !== scenarioRoute(page.url())
  )
    navigationBindings?.set(scenarioRoute(effect.afterUrl), page.url());
  return {
    detail: `Route transition verified: ${scenarioRoute(page.url())}. Query values and business results require their recorded checkpoints.`,
  };
}

type PuppeteerPage = {
  browser(): { wsEndpoint(): string };
  createCDPSession(): Promise<{
    send(method: string): Promise<{ targetInfo: { targetId: string } }>;
    detach(): Promise<void>;
  }>;
};

/** Connect to the exact Studio target; closing this CDP client only disconnects it. */
export async function connectScenarioPage(iface: unknown, signal: AbortSignal) {
  const underlying = (iface as { underlyingPage?: PuppeteerPage })
    ?.underlyingPage;
  if (!underlying?.browser || !underlying.createCDPSession)
    throw new Error('Scenario execution requires the Studio web browser.');
  signal.throwIfAborted();
  const session = await underlying.createCDPSession();
  let targetId: string;
  try {
    targetId = (await session.send('Target.getTargetInfo')).targetInfo.targetId;
  } finally {
    await session.detach();
  }
  const browser = await chromium.connectOverCDP(
    underlying.browser().wsEndpoint(),
    { timeout: 15000 },
  );
  const disconnect = () => {
    void browser.close().catch(() => {});
  };
  signal.addEventListener('abort', disconnect, { once: true });
  try {
    signal.throwIfAborted();
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const cdp = await context.newCDPSession(page);
        try {
          if (
            (await cdp.send('Target.getTargetInfo')).targetInfo.targetId ===
            targetId
          ) {
            page.setDefaultTimeout(10000);
            page.setDefaultNavigationTimeout(20000);
            const native = (
              iface as {
                studioNative?: {
                  captureScreenshot?: () => Promise<string>;
                  setViewport(size: {
                    width: number;
                    height: number;
                  }): Promise<void>;
                };
              }
            ).studioNative;
            if (native)
              page.setViewportSize = (size) => native.setViewport(size);
            const readiness = observeScenarioReadiness(page);
            return {
              page,
              ...(native?.captureScreenshot
                ? { captureScreenshot: native.captureScreenshot }
                : {}),
              waitForAssertionReady: (signal: AbortSignal) =>
                readiness.wait(signal),
              waitForEvidenceReady: (
                signal: AbortSignal,
                step?: ScenarioRunStep,
              ) =>
                readiness.waitForEvidence(
                  signal,
                  step?.event?.type === 'navigation' ? 5000 : 1500,
                ),
              close: async () => {
                readiness.dispose();
                signal.removeEventListener('abort', disconnect);
                await browser.close();
              },
            };
          }
        } finally {
          await cdp.detach();
        }
      }
    }
    throw new Error('The recorded browser page is no longer available.');
  } catch (error) {
    signal.removeEventListener('abort', disconnect);
    await browser.close();
    throw error;
  }
}

function locatorFor(page: Page, spec: MidsceneRecorderNativeLocator): Locator {
  const root = spec.scope ? locatorFor(page, spec.scope) : page;
  let locator = root.locator(spec.selector);
  if (spec.visible) locator = locator.filter({ visible: true });
  if (spec.text) {
    locator = locator.filter({
      hasText: new RegExp(recorderNativeTextPattern(spec.text)),
    });
  }
  if (spec.generatedText)
    locator = locator.filter({
      hasText: new RegExp(
        recorderNativeGeneratedTextPattern(spec.generatedText),
      ),
    });
  if (spec.has) locator = locator.filter({ has: locatorFor(page, spec.has) });
  for (const child of spec.hasAll || [])
    locator = locator.filter({ has: locatorFor(page, child) });
  return locator;
}

async function waitFor(
  check: () => Promise<boolean>,
  signal: AbortSignal,
  message: string,
) {
  const deadline = Date.now() + 10000;
  do {
    signal.throwIfAborted();
    if (await check()) return;
    await delay(100, undefined, { signal });
  } while (Date.now() < deadline);
  throw new Error(message);
}

/** Execute the compiler's supported action vocabulary, never arbitrary saved JS. */
export async function executeScenarioNative(
  page: Page,
  step: ScenarioRunStep,
  signal: AbortSignal,
  _scriptIndex: number,
  options?: {
    navigationEffect?: ScenarioNavigationEffect;
    navigationBindings?: Map<string, string>;
    waitReady?: (signal: AbortSignal) => Promise<void>;
    beforeAction?: (target: Locator) => Promise<void>;
  },
) {
  const event = step.event!;
  signal.throwIfAborted();
  if (options?.navigationEffect)
    options.navigationEffect.runtime = { beforeUrl: page.url() };
  // Older native recordings included Windows IME composition notifications.
  // They are not physical keys; the following Input carries committed text.
  if (
    event.source === 'studio-preview' &&
    event.type === 'keydown' &&
    event.value === 'Process'
  ) {
    return {
      detail:
        'Ignored an input-method composition notification; recorded Input steps supply the committed text.',
    };
  }
  if (event.type === 'navigation') {
    const action = event.actionType;
    if (action === 'GoBack') await page.goBack();
    else if (action === 'GoForward') await page.goForward();
    else if (action === 'Reload') await page.reload();
    else if (
      action === 'NavigationChanged' ||
      event.rawPayload?.implicitNavigationState
    ) {
      // An automatically observed URL is recording context, not a checkpoint.
      // Redirects can already have moved beyond it. Never navigate back to it;
      // subsequent targets auto-wait and explicit Agent checkpoints verify state.
      await page.waitForLoadState('domcontentloaded');
      return {
        detail:
          'Observed URL is recording context; no navigation outcome was verified.',
      };
    } else {
      const recordedUrl = new URL(event.url!).href;
      const binding = options?.navigationBindings?.get(
        scenarioRoute(recordedUrl),
      );
      const url =
        binding &&
        (!isScenarioTransientUrl(recordedUrl) ||
          sameScenarioPage(recordedUrl, binding))
          ? binding
          : recordedUrl;
      // Every script can start independently. Preserve the current document
      // when already at its start; otherwise actively open it instead of waiting
      // for a navigation that no preceding action will perform.
      const atStart =
        page.url() === url ||
        (isScenarioTransientUrl(url) &&
          scenarioRoute(page.url()) === scenarioRoute(url) &&
          sameScenarioPage(url, page.url()));
      if (action !== 'InitialNavigation' || !atStart) {
        if (isScenarioTransientUrl(url) && url === recordedUrl)
          throw new ScenarioBlockedError(
            '录制地址属于临时详情页，请先执行打开该详情页的前置脚本。',
          );
        await page.goto(url, { waitUntil: 'domcontentloaded' });
      }
    }
    return;
  }
  if (event.type === 'setViewport') {
    await page.setViewportSize({
      width: event.pageInfo.width,
      height: event.pageInfo.height,
    });
    return;
  }
  const native = event.nativeTarget!;
  const guard = async (guards: typeof native.guards) => {
    for (const g of guards || [])
      await waitFor(
        async () => (await page.locator(g.selector).count()) === g.count,
        signal,
        'The recorded page structure has changed.',
      );
  };
  await guard(native.guards);
  let target = locatorFor(page, native.locator!);
  let reboundDialog: string | undefined;
  try {
    await waitFor(
      async () => {
        const count = await target.count();
        if (count === 1) return true;
        // An ambiguous original locator must stay ambiguous. Only a missing
        // legacy generated scope can be adapted, with a unique corroborated
        // dialog and the unchanged recorded leaf/field constraints.
        if (count === 0 && !reboundDialog) {
          const rebound = await rebindScenarioFilterLocator(page, step);
          if (rebound) {
            const candidate = locatorFor(page, rebound.locator);
            if ((await candidate.count()) === 1) {
              target = candidate;
              reboundDialog = rebound.dialogTitle;
              debugScenario('Recorded temporary filter scope rebound: %o', {
                stepId: step.id,
                dialogTitle: reboundDialog,
              });
              return true;
            }
          }
        }
        return false;
      },
      signal,
      'The recorded target is missing or is not unique.',
    );
  } catch (error) {
    signal.throwIfAborted();
    debugScenario('Recorded target lookup failed: %o', {
      stepId: step.id,
      actionType: event.actionType,
      recordedRoute: event.url ? scenarioRoute(event.url) : undefined,
      actualRoute: scenarioRoute(page.url()),
      targetCount: await target.count().catch(() => undefined),
      ...(await pageDiagnostics(page)),
    });
    throw error;
  }
  await options?.beforeAction?.(target);
  signal.throwIfAborted();
  if (options?.navigationEffect) {
    const href = await target.evaluate((element) => {
      const anchor = element.closest('a[href]') as HTMLAnchorElement | null;
      return anchor?.href;
    });
    options.navigationEffect.runtime!.targetUrl = scenarioLiveNavigationTarget(
      options.navigationEffect,
      href,
    );
  }
  switch (event.type) {
    case 'click':
      if (event.actionType === 'DoubleClick') await target.dblclick();
      else
        await target.click({
          button: event.actionType === 'RightClick' ? 'right' : 'left',
          delay:
            event.actionType === 'LongPress'
              ? Number(event.rawPayload?.duration ?? 1000)
              : undefined,
        });
      break;
    case 'input': {
      const value = event.rawPayload?.mode === 'clear' ? '' : event.value!;
      // Scenario recordings retain their input values, including test passwords.
      if (typeof value !== 'string')
        throw new Error('Recorded input value is missing.');
      if (event.rawPayload?.mode !== 'typeOnly') {
        await target.fill(value);
        break;
      }
      await target.focus();
      if (native.contentEditableSelection) {
        await target.evaluate((element, selection) => {
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
          );
          const nodes: Node[] = [];
          let node = walker.nextNode();
          while (node) {
            nodes.push(node);
            node = walker.nextNode();
          }
          const boundary = (offset: number): [Node, number] => {
            for (const n of nodes) {
              const length = n.textContent?.length || 0;
              if (offset <= length) return [n, offset];
              offset -= length;
            }
            if (offset > 0)
              throw new Error(
                'Editable content changed; selection cannot be restored',
              );
            return [element, element.childNodes.length];
          };
          const range = document.createRange();
          range.setStart(...boundary(selection.start));
          range.setEnd(...boundary(selection.end));
          const current = window.getSelection();
          current?.removeAllRanges();
          current?.addRange(range);
        }, native.contentEditableSelection);
      } else {
        await target.evaluate((element, selection) => {
          const input = element as HTMLInputElement;
          input.setSelectionRange(
            selection.valueLength !== undefined &&
              selection.start === selection.valueLength
              ? input.value.length
              : selection.start,
            selection.valueLength !== undefined &&
              selection.end === selection.valueLength
              ? input.value.length
              : selection.end,
          );
        }, native.selection!);
      }
      await target.pressSequentially(value);
      break;
    }
    case 'keydown':
      await target.press(event.value!);
      break;
    case 'drag': {
      const drop = native.dropTarget!;
      await guard(drop.guards);
      const destination = locatorFor(page, drop.locator!);
      await waitFor(
        async () => (await destination.count()) === 1,
        signal,
        'The recorded drop target is missing or is not unique.',
      );
      await target.dragTo(destination, {
        sourcePosition: await target.evaluate(
          (e, p) => ({ x: e.clientWidth * p.x, y: e.clientHeight * p.y }),
          native.position!,
        ),
        targetPosition: await destination.evaluate(
          (e, p) => ({ x: e.clientWidth * p.x, y: e.clientHeight * p.y }),
          drop.position!,
        ),
      });
      break;
    }
    case 'scroll':
      await target.evaluate((element, payload) => {
        const { scrollType, direction, distance } = payload;
        const edges: Record<string, ScrollToOptions> = {
          scrollToTop: { top: 0 },
          scrollToBottom: { top: element.scrollHeight },
          scrollToLeft: { left: 0 },
          scrollToRight: { left: element.scrollWidth },
        };
        if (typeof scrollType === 'string' && edges[scrollType])
          element.scrollTo({ ...edges[scrollType], behavior: 'instant' });
        else
          element.scrollBy({
            left:
              direction === 'left'
                ? -Number(distance)
                : direction === 'right'
                  ? Number(distance)
                  : 0,
            top:
              direction === 'up'
                ? -Number(distance)
                : direction === 'down'
                  ? Number(distance)
                  : 0,
            behavior: 'instant',
          });
      }, event.rawPayload || {});
      break;
    default:
      throw new Error('Unsupported recorded operation.');
  }
  if (options?.navigationEffect) {
    return waitForScenarioNavigation(
      page,
      options.navigationEffect,
      signal,
      options.waitReady,
      undefined,
      options.navigationBindings,
    );
  }
  return {
    detail: reboundDialog
      ? `已按弹窗“${reboundDialog}”匹配当前筛选区，保留原操作与输入。操作已执行，业务结果仍由检查点验证。`
      : 'Native action dispatched; its business outcome was not independently verified.',
  };
}
