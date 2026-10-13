import { setTimeout as delay } from 'node:timers/promises';
import { getDebug } from '@midscene/shared/logger';
import type { Page, Request } from 'playwright-core';
import { scenarioRoute } from './scenario-navigation';

const debugReadiness = getDebug('scenario:readiness', { console: true });

export const SCENARIO_PAGE_NOT_READY =
  'The page is still loading or changing. The assertion was not evaluated.';

/** Observe from before the first operation so in-flight queries are not missed. */
export function observeScenarioReadiness(page: Page) {
  const pending = new Set<Request>();
  let lastNetworkChange = Date.now();
  const started = (request: Request) => {
    if (!['document', 'xhr', 'fetch'].includes(request.resourceType())) return;
    pending.add(request);
    lastNetworkChange = Date.now();
  };
  const finished = (request: Request) => {
    if (pending.delete(request)) lastNetworkChange = Date.now();
  };
  page.on('request', started);
  page.on('requestfinished', finished);
  page.on('requestfailed', finished);

  return {
    async wait(signal: AbortSignal, timeoutMs = 20000, quietMs = 800) {
      signal.throwIfAborted();
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(
        () => controller.abort(new Error(SCENARIO_PAGE_NOT_READY)),
        timeoutMs,
      );
      // Race page evaluation too: a busy renderer must not defeat timeout/stop.
      const cancelled = new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(controller.signal.reason),
          { once: true },
        );
      });
      const inspect = async () => {
        let previous = '';
        let stableSince = Date.now();
        while (true) {
          controller.signal.throwIfAborted();
          const state = await page
            .evaluate(() => {
              const loading = Array.from(
                document.querySelectorAll(
                  '[aria-busy="true"], [role="progressbar"], ' +
                    '[class~="ant-spin-spinning"], [class*="-spin-spinning"], ' +
                    '.ant-skeleton, .el-loading-mask',
                ),
              ).some((element) => {
                const rect = element.getBoundingClientRect();
                return (
                  rect.width > 0 &&
                  rect.height > 0 &&
                  rect.bottom > 0 &&
                  rect.right > 0 &&
                  rect.top < innerHeight &&
                  rect.left < innerWidth &&
                  element.checkVisibility({
                    checkOpacity: true,
                    checkVisibilityCSS: true,
                  })
                );
              });
              return {
                readyState: document.readyState,
                loading: loading || document.readyState === 'loading',
                // Check readiness only; business expectations remain visual assertions.
                content: `${location.href}\n${document.body?.innerText ?? ''}`,
              };
            })
            .catch((error: unknown) => {
              // A real navigation destroys the old document's execution context.
              // Keep observing the replacement document within the same budget.
              if (
                error instanceof Error &&
                /Execution context was destroyed|Cannot find context with specified id/i.test(
                  error.message,
                )
              )
                return undefined;
              throw error;
            });
          if (!state) {
            stableSince = Date.now();
            previous = '';
            await delay(100, undefined, { signal: controller.signal });
            continue;
          }
          diagnostics = {
            readyState: state.readyState,
            loading: state.loading,
          };
          const now = Date.now();
          if (state.loading || pending.size || state.content !== previous) {
            stableSince = now;
          }
          previous = state.content;
          if (now - Math.max(stableSince, lastNetworkChange) >= quietMs) return;
          await delay(100, undefined, { signal: controller.signal });
        }
      };
      let diagnostics: { readyState?: string; loading: boolean } | undefined;
      try {
        await Promise.race([inspect(), cancelled]);
      } catch (error) {
        debugReadiness('Page readiness failed: %o', {
          actualRoute: scenarioRoute(page.url()),
          pendingRequests: pending.size,
          ...diagnostics,
        });
        throw error;
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        controller.abort();
      }
    },
    dispose() {
      page.off('request', started);
      page.off('requestfinished', finished);
      page.off('requestfailed', finished);
      pending.clear();
    },
  };
}
