import type {
  MidsceneRecorderEvent,
  MidsceneRecorderNativeLocator,
} from './recorder';

import { captureRecorderNativeTarget } from './recorder-native-capture';
export { captureRecorderNativeTarget } from './recorder-native-capture';

export function buildRecorderNativeCaptureScript(
  payload: Record<string, unknown>,
) {
  // Only pointer metadata is sent; input values (including passwords) stay out
  // of the evaluated capture script.
  const point = {
    actionType: payload.actionType,
    x: payload.x,
    y: payload.y,
    mode: payload.mode,
    direction: payload.direction,
    scrollType: payload.scrollType,
  };
  return `(${captureRecorderNativeTarget.toString()})(${JSON.stringify(point)})`;
}

function textPatternPart(text: string) {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
}

export function recorderNativeTextPattern(text: string) {
  return `^\\s*${textPatternPart(text)}\\s*$`;
}

export function recorderNativeGeneratedTextPattern(template: {
  prefix: string;
  suffix: string;
}) {
  return `^\\s*${textPatternPart(template.prefix)}\\d+${textPatternPart(template.suffix)}\\s*$`;
}

export function recorderNativeLocatorExpression(
  locator: MidsceneRecorderNativeLocator,
  root = 'page',
): string {
  const scopedRoot = locator.scope
    ? recorderNativeLocatorExpression(locator.scope, root)
    : root;
  let expression = `${scopedRoot}.locator(${JSON.stringify(locator.selector)})`;
  if (locator.visible) expression += '.filter({ visible: true })';
  if (locator.text)
    expression += `.filter({ hasText: new RegExp(${JSON.stringify(recorderNativeTextPattern(locator.text))}) })`;
  if (locator.generatedText)
    expression += `.filter({ hasText: new RegExp(${JSON.stringify(recorderNativeGeneratedTextPattern(locator.generatedText))}) })`;
  if (locator.has)
    expression += `.filter({ has: ${recorderNativeLocatorExpression(locator.has)} })`;
  for (const child of locator.hasAll || [])
    expression += `.filter({ has: ${recorderNativeLocatorExpression(child)} })`;
  return expression;
}

/** Deterministic compiler: no model, screenshots or AI fallbacks. */
export function compileRecorderNativePlaywright(input: {
  events: MidsceneRecorderEvent[];
  testName?: string;
  platformId?: string;
  /** Same-page statements for a mixed scenario, without creating a test/page. */
  format?: 'test' | 'operation';
  /** Preserve operation numbering (including sensitive-input environment keys). */
  stepOffset?: number;
  /** Studio scenarios may retain recorded test credentials for repeatable local runs. */
  sensitiveInputs?: 'environment' | 'recorded';
  /** Scenario snapshots describe navigation; only explicit checkpoints assert it. */
  navigationMode?: 'recorded' | 'scenario';
}) {
  if (input.platformId && input.platformId !== 'web')
    throw new Error('原生 Playwright 仅支持 Web 录制。');
  if (!input.events.length) throw new Error('请先录制操作。');
  if (
    input.stepOffset !== undefined &&
    (!Number.isSafeInteger(input.stepOffset) || input.stepOffset < 0)
  ) {
    throw new Error('Invalid recorded operation offset.');
  }
  const errors: string[] = [];
  const lines: string[] = [];
  const envKeys: string[] = [];
  const quoted = JSON.stringify;
  input.events.forEach((event, index) => {
    const step = index + 1 + (input.stepOffset ?? 0);
    const fail = (message: string) =>
      errors.push(
        `第 ${step} 步 (${event.actionType || event.type})：${message}`,
      );
    lines.push(`  // Step ${step}: ${event.type}`);
    if (event.type === 'navigation') {
      if (event.actionType === 'GoBack') lines.push('  await page.goBack();');
      else if (event.actionType === 'GoForward')
        lines.push('  await page.goForward();');
      else if (event.actionType === 'Reload')
        lines.push('  await page.reload();');
      else if (event.actionType === 'Stop') fail('停止加载暂不支持。');
      else if (!event.url) fail('缺少 URL。');
      else if (
        event.actionType === 'NavigationChanged' ||
        event.rawPayload?.implicitNavigationState
      ) {
        lines.push(
          input.navigationMode === 'scenario'
            ? "  await page.waitForLoadState('domcontentloaded');"
            : `  await expect(page).toHaveURL(${quoted(event.url)});`,
        );
      } else if (
        input.navigationMode === 'scenario' &&
        event.actionType === 'InitialNavigation'
      ) {
        lines.push(
          `  if (page.url() !== new URL(${quoted(event.url)}).href) {`,
          `    await page.goto(${quoted(event.url)}, { waitUntil: 'domcontentloaded' });`,
          '  }',
        );
      } else lines.push(`  await page.goto(${quoted(event.url)});`);
      return;
    }
    if (event.type === 'setViewport') {
      const { width, height } = event.pageInfo;
      if (width > 0 && height > 0)
        lines.push(
          `  await page.setViewportSize({ width: ${width}, height: ${height} });`,
        );
      else fail('缺少视口尺寸。');
      return;
    }
    const target = event.nativeTarget;
    if (!target?.locator) {
      fail(target?.error || '缺少录制时的 DOM 定位信息，请重新录制。');
      return;
    }
    const locator = recorderNativeLocatorExpression(target.locator);
    const variable = `target${step}`;
    for (const guard of target.guards || []) {
      lines.push(
        `  await expect(page.locator(${quoted(guard.selector)})).toHaveCount(${guard.count});`,
      );
    }
    if (target.strategy === 'playwright-structure')
      lines.push(
        '  // Positional fallback: re-record if the order of identical controls changes.',
      );
    lines.push(
      `  const ${variable} = ${locator};`,
      `  await expect(${variable}).toHaveCount(1);`,
    );
    switch (event.type) {
      case 'drag': {
        const drop = target.dropTarget;
        if (!drop?.locator || !target.position || !drop.position) {
          fail('缺少拖拽起点或终点，请重新录制。');
          break;
        }
        const positions = [target.position, drop.position];
        if (
          positions.some(
            (p) =>
              !Number.isFinite(p.x) ||
              !Number.isFinite(p.y) ||
              p.x < 0 ||
              p.x > 1 ||
              p.y < 0 ||
              p.y > 1,
          )
        ) {
          fail('拖拽位置超出元素范围。');
          break;
        }
        for (const guard of drop.guards || [])
          lines.push(
            `  await expect(page.locator(${quoted(guard.selector)})).toHaveCount(${guard.count});`,
          );
        lines.push(
          `  const drop${step} = ${recorderNativeLocatorExpression(drop.locator)};`,
          `  await expect(drop${step}).toHaveCount(1);`,
          `  await ${variable}.dragTo(drop${step}, {`,
          `    sourcePosition: await ${variable}.evaluate(el => ({ x: el.clientWidth * ${target.position.x}, y: el.clientHeight * ${target.position.y} })),`,
          `    targetPosition: await drop${step}.evaluate(el => ({ x: el.clientWidth * ${drop.position.x}, y: el.clientHeight * ${drop.position.y} })),`,
          '  });',
        );
        break;
      }
      case 'click':
        if (
          ![
            'Tap',
            'Click',
            'DoubleClick',
            'RightClick',
            'LongPress',
            undefined,
          ].includes(event.actionType)
        ) {
          fail('未知点击动作。');
          break;
        }
        if (event.actionType === 'LongPress') {
          const duration = event.rawPayload?.duration ?? 1000;
          if (
            typeof duration !== 'number' ||
            !Number.isFinite(duration) ||
            duration < 0
          ) {
            fail('长按时长无效。');
            break;
          }
          lines.push(`  await ${variable}.click({ delay: ${duration} });`);
          break;
        }
        lines.push(
          `  await ${variable}.${event.actionType === 'DoubleClick' ? 'dblclick()' : event.actionType === 'RightClick' ? "click({ button: 'right' })" : 'click()'};`,
        );
        break;
      case 'input': {
        if (!target.editable) {
          fail('未找到可输入的元素。');
          break;
        }
        if (event.value === undefined) {
          fail('缺少输入值。');
          break;
        }
        let value = quoted(
          event.rawPayload?.mode === 'clear' ? '' : event.value,
        );
        if (
          target.sensitive &&
          event.rawPayload?.mode !== 'clear' &&
          input.sensitiveInputs !== 'recorded'
        ) {
          const key = `MIDSCENE_INPUT_${String(step).padStart(3, '0')}`;
          envKeys.push(key);
          value = `requiredEnv(${quoted(key)})`;
        }
        if (event.rawPayload?.mode === 'typeOnly') {
          if (target.contentEditableSelection) {
            const { start, end } = target.contentEditableSelection;
            lines.push(
              `  await ${variable}.focus();`,
              `  await ${variable}.evaluate(element => {`,
              '    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);',
              '    const nodes: Node[] = []; let node: Node | null;',
              '    while ((node = walker.nextNode())) nodes.push(node);',
              '    const boundary = (offset: number): [Node, number] => {',
              '      for (const node of nodes) { const length = node.textContent?.length || 0; if (offset <= length) return [node, offset]; offset -= length; }',
              '      if (offset > 0) throw new Error("Editable content changed; selection cannot be restored");',
              '      return [element, element.childNodes.length];',
              '    };',
              `    const range = document.createRange(); range.setStart(...boundary(${start})); range.setEnd(...boundary(${end}));`,
              '    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);',
              '  });',
              `  await ${variable}.pressSequentially(${value});`,
            );
            break;
          }
          if (!target.selection) {
            fail('缺少光标位置，无法还原追加输入。');
            break;
          }
          const { start, end, valueLength } = target.selection;
          const selectionEnd =
            valueLength !== undefined && end === valueLength
              ? 'element.value.length'
              : String(end);
          const selectionStart =
            valueLength !== undefined && start === valueLength
              ? 'element.value.length'
              : String(start);
          lines.push(
            `  await ${variable}.focus();`,
            `  await ${variable}.evaluate((element: HTMLInputElement | HTMLTextAreaElement) => element.setSelectionRange(${selectionStart}, ${selectionEnd}));`,
            `  await ${variable}.pressSequentially(${value});`,
          );
        } else lines.push(`  await ${variable}.fill(${value});`);
        break;
      }
      case 'keydown':
        if (!event.value) fail('缺少按键。');
        else lines.push(`  await ${variable}.press(${quoted(event.value)});`);
        break;
      case 'scroll': {
        const { direction, distance, scrollType } = event.rawPayload || {};
        const edges: Record<string, string> = {
          scrollToTop: '{ top: 0 }',
          scrollToBottom: '{ top: element.scrollHeight }',
          scrollToLeft: '{ left: 0 }',
          scrollToRight: '{ left: element.scrollWidth }',
        };
        if (typeof scrollType === 'string' && edges[scrollType]) {
          lines.push(
            `  await ${variable}.evaluate((element) => element.scrollTo({ ...${edges[scrollType]}, behavior: 'instant' }));`,
          );
          break;
        }
        if (scrollType && scrollType !== 'singleAction') {
          fail('不支持该滚动类型。');
          break;
        }
        if (
          !['up', 'down', 'left', 'right'].includes(String(direction)) ||
          typeof distance !== 'number' ||
          !Number.isFinite(distance)
        ) {
          fail('缺少明确的滚动方向 / 距离。');
          break;
        }
        const x =
          direction === 'left'
            ? -distance
            : direction === 'right'
              ? distance
              : 0;
        const y =
          direction === 'up' ? -distance : direction === 'down' ? distance : 0;
        lines.push(
          `  await ${variable}.evaluate((element) => element.scrollBy({ left: ${x}, top: ${y}, behavior: 'instant' }));`,
        );
        break;
      }
      default:
        fail('不支持该动作。');
    }
  });
  if (errors.length)
    throw new Error(`无法导出原生 Playwright：\n${errors.join('\n')}`);
  const prelude = envKeys.length
    ? [
        `// Required environment variables: ${envKeys.join(', ')}`,
        'function requiredEnv(name: string): string {',
        '  const value = process.env[name];',
        '  if (value === undefined) throw new Error(`Missing environment variable: ${name}`);',
        '  return value;',
        '}',
        '',
      ]
    : [];
  const viewport = input.events[0].pageInfo;
  if (input.format === 'operation') {
    // Scope generated target variables and sensitive-input helpers so separately
    // compiled operations can be concatenated on the same page safely.
    return ['{', ...prelude, ...lines, '}'].join('\n');
  }
  return [
    "import { test, expect } from '@playwright/test';",
    '// Generated with Playwright 1.58.1 selector support.',
    '',
    ...(viewport.width > 0 && viewport.height > 0
      ? [
          `test.use({ viewport: { width: ${viewport.width}, height: ${viewport.height} } });`,
          '',
        ]
      : []),
    ...prelude,
    '// Recorded operations only. Add business assertions for your expected result.',
    `test(${quoted(input.testName || 'Recorded browser flow')}, async ({ page }) => {`,
    ...lines,
    '});',
    '',
  ].join('\n');
}
