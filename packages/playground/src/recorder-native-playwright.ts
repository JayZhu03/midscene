import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { MidsceneRecorderNativeTarget } from '@midscene/shared/recorder';
import { captureRecorderNativeTarget } from '@midscene/shared/recorder-native';

// Playwright's injected selector generator is an internal API. Keep the exact
// dependency pinned and exercise it in a real browser when upgrading it.
let injectedSource: string | undefined;
function selectorSource() {
  if (!injectedSource) {
    const require = createRequire(
      typeof __filename !== 'undefined' ? __filename : import.meta.url,
    );
    const root = dirname(require.resolve('playwright-core/package.json'));
    injectedSource = require(
      join(root, 'lib/generated/injectedScriptSource.js'),
    ).source;
  }
  return injectedSource!;
}

/** Runs inside the page; contains no references to Node modules. */
export function generateFallback(
  element: Element,
): MidsceneRecorderNativeTarget {
  type Engine = {
    generateSelectorSimple: (node: Element, options: object) => string;
    parseSelector: (selector: string) => unknown;
    querySelectorAll: (selector: unknown, root: Document) => Element[];
  };
  const engine = (
    window as unknown as { __midsceneSelectorEngine1581?: Engine }
  ).__midsceneSelectorEngine1581;
  if (!engine) return { error: 'PLAYWRIGHT_GENERATOR_REQUIRED' };
  try {
    let selector = engine.generateSelectorSimple(element, { noCSSId: true });
    const query = (value: string) =>
      engine.querySelectorAll(engine.parseSelector(value), document);
    let matches = query(selector);
    // Playwright codegen can promote a child to its interactive ancestor.
    // Preserve exact Ant Design sub-controls rather than clicking the parent.
    if (
      matches.length === 1 &&
      matches[0] !== element &&
      matches[0].contains(element)
    ) {
      const path: string[] = [];
      let current: Element | null = element;
      while (current && current !== matches[0]) {
        const siblings = Array.from(
          current.parentElement?.children || [],
        ).filter((node) => node.tagName === current!.tagName);
        if (!siblings.length) break;
        path.unshift(
          `${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`,
        );
        current = current.parentElement;
      }
      if (current === matches[0]) {
        selector += ` >> css=:scope > ${path.join(' > ')}`;
        matches = query(selector);
      }
    }
    if (matches.length !== 1 || matches[0] !== element)
      return { error: '无法确认操作目标。' };
    const guards: Array<{ selector: string; count: number }> = [];
    // A positional selector is acceptable only for the captured candidate set.
    // Detect inserted/removed duplicates instead of silently changing targets.
    const nth = /\s*>>\s*nth=\d+/g;
    for (const match of selector.matchAll(nth)) {
      const prefix = selector.slice(0, match.index).trim();
      guards.push({ selector: prefix, count: query(prefix).length });
    }
    const positional =
      guards.length > 0 || /:nth-(?:child|of-type)\(/.test(selector);
    return {
      locator: { selector },
      strategy: positional ? 'playwright-structure' : 'playwright',
      ...(guards.length ? { guards } : {}),
    };
  } catch {
    return { error: 'Playwright 定位采集失败。' };
  }
}

/** Install the same locator engine used by preview recording before native input. */
export function nativeRecorderCaptureSource() {
  return `const module = { exports: {} };
    (function(module) { ${selectorSource()} })(module);
    window.__midsceneSelectorEngine1581 = new (module.exports.InjectedScript())(window, {
      isUnderTest: false, sdkLanguage: 'javascript', testIdAttributeName: 'data-testid',
      stableRafCount: 1, browserName: 'chromium', customEngines: [],
    });
    const capture = ${captureRecorderNativeTarget.toString()};
    const fallback = ${generateFallback.toString()};`;
}

export function buildPlaywrightRecorderCaptureScript(
  payload: Record<string, unknown>,
  installGenerator = false,
) {
  // Never send input values or credentials through this script.
  const point = {
    actionType: payload.actionType,
    x: payload.x,
    y: payload.y,
    mode: payload.mode,
    direction: payload.direction,
    scrollType: payload.scrollType,
    endX: payload.endX,
    endY: payload.endY,
  };
  const install = installGenerator
    ? `
    if (!window.__midsceneSelectorEngine1581) {
      const module = { exports: {} };
      (function(module) { ${selectorSource()} })(module);
      window.__midsceneSelectorEngine1581 = new (module.exports.InjectedScript())(window, {
        isUnderTest: false, sdkLanguage: 'javascript', testIdAttributeName: 'data-testid',
        stableRafCount: 1, browserName: 'chromium', customEngines: [],
      });
    }`
    : '';
  return `(() => { ${install}
    const capture = ${captureRecorderNativeTarget.toString()};
    const fallback = ${generateFallback.toString()};
    const point = ${JSON.stringify(point)};
    const result = capture(point, fallback);
    if (point.actionType === 'DragAndDrop' && typeof point.endX === 'number' && typeof point.endY === 'number') {
      result.dropTarget = capture({ ...point, x: point.endX, y: point.endY }, fallback);
    }
    return result;
  })()`;
}

export async function capturePlaywrightRecorderTarget(
  evaluate: (script: string) => Promise<unknown>,
  payload: Record<string, unknown>,
): Promise<MidsceneRecorderNativeTarget> {
  let result = (await evaluate(
    buildPlaywrightRecorderCaptureScript(payload),
  )) as MidsceneRecorderNativeTarget;
  if (
    result?.error === 'PLAYWRIGHT_GENERATOR_REQUIRED' ||
    result?.dropTarget?.error === 'PLAYWRIGHT_GENERATOR_REQUIRED'
  ) {
    // Lazy install once per document, only when semantic capture needs help.
    // No recorder overlay or action handlers are installed: actions run once.
    result = (await evaluate(
      buildPlaywrightRecorderCaptureScript(payload, true),
    )) as MidsceneRecorderNativeTarget;
  }
  return result;
}
