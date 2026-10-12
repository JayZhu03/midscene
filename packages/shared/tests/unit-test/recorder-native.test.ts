import { describe, expect, it } from '@rstest/core';
import type { MidsceneRecorderEvent } from '../../src/recorder';
import {
  buildRecorderNativeCaptureScript,
  compileRecorderNativePlaywright,
  recorderNativeLocatorExpression,
} from '../../src/recorder-native';

const event = (
  overrides: Partial<MidsceneRecorderEvent> = {},
): MidsceneRecorderEvent => ({
  type: 'click',
  actionType: 'Tap',
  pageInfo: { width: 1280, height: 720 },
  timestamp: 1,
  hashId: 'step',
  nativeTarget: { locator: { selector: 'button', text: '登 录' } },
  ...overrides,
});

describe('native Playwright compiler', () => {
  it('keeps scenario navigation snapshots separate from explicit checkpoints', () => {
    const code = compileRecorderNativePlaywright({
      events: [
        event({
          type: 'navigation',
          actionType: 'InitialNavigation',
          url: 'https://example.com/orders',
        }),
        event({
          type: 'navigation',
          actionType: 'NavigationChanged',
          url: 'https://example.com/redirect',
        }),
        event({
          type: 'navigation',
          actionType: 'Navigate',
          rawPayload: { implicitNavigationState: true },
          url: 'https://example.com/orders?id=old',
        }),
        event({
          type: 'navigation',
          actionType: 'Navigate',
          url: 'https://example.com/new',
        }),
      ],
      format: 'operation',
      navigationMode: 'scenario',
    });
    expect(code).toContain(
      'if (page.url() !== new URL("https://example.com/orders").href)',
    );
    expect(code.match(/waitForLoadState/g)).toHaveLength(2);
    expect(code).not.toContain('toHaveURL');
    expect(code).not.toContain('goto("https://example.com/redirect")');
    expect(code).toContain('goto("https://example.com/new")');
  });
  it('can explicitly embed recorded test passwords without changing the default export mode', () => {
    const input = event({
      type: 'input',
      value: 'test"\\password',
      nativeTarget: {
        locator: { selector: 'input' },
        editable: true,
        sensitive: true,
      },
    });
    const code = compileRecorderNativePlaywright({
      events: [input],
      format: 'operation',
      sensitiveInputs: 'recorded',
    });
    expect(code).toContain(`fill(${JSON.stringify(input.value)})`);
    expect(code).not.toContain('MIDSCENE_INPUT_');
    expect(compileRecorderNativePlaywright({ events: [input] })).toContain(
      'MIDSCENE_INPUT_001',
    );
  });
  it('compiles scoped operations on the existing page without a new test', () => {
    const code = compileRecorderNativePlaywright({
      events: [event()],
      format: 'operation',
    });
    expect(code).toContain('const target1 = page.locator(');
    expect(code).toContain('await target1.click();');
    expect(code.startsWith('{\n')).toBe(true);
    expect(code.endsWith('\n}')).toBe(true);
    expect(code).not.toMatch(/import |test\(|test.use|newPage/);
    const password = compileRecorderNativePlaywright({
      events: [
        event({
          type: 'input',
          value: 'private-value',
          nativeTarget: {
            locator: { selector: 'input' },
            editable: true,
            sensitive: true,
          },
        }),
      ],
      format: 'operation',
    });
    expect(password).toContain('function requiredEnv(name: string)');
    expect(password).toContain('await target1.fill(requiredEnv(');
    expect(password).not.toContain('private-value');
    const laterPassword = compileRecorderNativePlaywright({
      events: [
        event({
          type: 'input',
          value: 'private-value',
          nativeTarget: {
            locator: { selector: 'input' },
            editable: true,
            sensitive: true,
          },
        }),
      ],
      format: 'operation',
      stepOffset: 8,
    });
    expect(laterPassword).toContain('MIDSCENE_INPUT_009');
    expect(laterPassword).toContain('target9.fill(');
  });
  it('preserves explicit navigation and waits for observed navigation instead of repeating goto', () => {
    const code = compileRecorderNativePlaywright({
      events: [
        event({
          type: 'navigation',
          actionType: 'InitialNavigation',
          url: 'https://example.com/login',
        }),
        event(),
        event({
          type: 'navigation',
          actionType: 'Navigate',
          rawPayload: { implicitNavigationState: true },
          url: 'https://example.com/orders',
        }),
      ],
    });
    expect(code).toContain('await page.goto("https://example.com/login")');
    expect(code).toContain(
      'await expect(page).toHaveURL("https://example.com/orders")',
    );
    expect(code).not.toContain('page.goto("https://example.com/orders")');
    expect(code).not.toMatch(/@midscene|aiTap|aiInput|page\.mouse/);
  });

  it('keeps replace, clear, append and selection distinct and parameterizes passwords', () => {
    const input = event({
      type: 'input',
      value: 'a"\n',
      nativeTarget: {
        editable: true,
        locator: { selector: 'input[name="user"]' },
        selection: { start: 2, end: 4 },
      },
    });
    const code = compileRecorderNativePlaywright({
      testName: 'a"\n`',
      events: [
        input,
        { ...input, rawPayload: { mode: 'clear' } },
        { ...input, rawPayload: { mode: 'typeOnly' } },
        {
          ...input,
          value: 'do-not-export-this-secret',
          nativeTarget: { ...input.nativeTarget, sensitive: true },
        },
      ],
    });
    expect(code).toContain('target1.fill("a\\"\\n")');
    expect(code).toContain('target2.fill("")');
    expect(code).toContain('setSelectionRange(2, 4)');
    expect(code).toContain('target3.pressSequentially(');
    expect(code).toContain('requiredEnv("MIDSCENE_INPUT_004")');
    expect(code).not.toContain('do-not-export-this-secret');
  });

  it('uses the runtime input length for end-of-field typing when environment values differ', () => {
    const code = compileRecorderNativePlaywright({
      events: [
        event({
          type: 'input',
          value: 'x',
          rawPayload: { mode: 'typeOnly' },
          nativeTarget: {
            editable: true,
            sensitive: true,
            locator: { selector: 'input[type="password"]' },
            selection: { start: 5, end: 5, valueLength: 5 },
          },
        }),
      ],
    });
    expect(code).toContain(
      'setSelectionRange(element.value.length, element.value.length)',
    );
  });

  it('reports every unresolved step without coordinate guesses or dropped actions', () => {
    expect(() =>
      compileRecorderNativePlaywright({
        events: [
          event({ nativeTarget: undefined, elementRect: { x: 10, y: 20 } }),
          event({ nativeTarget: { error: '定位不唯一' } }),
          event({ type: 'drag' }),
        ],
      }),
    ).toThrow(/第 1 步.*\n第 2 步.*定位不唯一.*\n第 3 步/);
  });

  it('rejects append without selection and scroll semantics it cannot preserve', () => {
    expect(() =>
      compileRecorderNativePlaywright({
        events: [
          event({
            type: 'input',
            value: 'x',
            rawPayload: { mode: 'typeOnly' },
            nativeTarget: { editable: true, locator: { selector: 'input' } },
          }),
        ],
      }),
    ).toThrow('缺少光标位置');
    expect(() =>
      compileRecorderNativePlaywright({
        events: [
          event({
            type: 'scroll',
            rawPayload: {
              direction: 'down',
              distance: 100,
              scrollType: 'unknownScroll',
            },
          }),
        ],
      }),
    ).toThrow('不支持该滚动类型');
  });

  it('exports edge scrolling, long press and guarded positional selectors', () => {
    const code = compileRecorderNativePlaywright({
      events: [
        event({
          type: 'scroll',
          rawPayload: { scrollType: 'scrollToRight' },
          nativeTarget: { locator: { selector: '#table' } },
        }),
        event({
          actionType: 'LongPress',
          rawPayload: { duration: 800 },
          nativeTarget: {
            locator: {
              selector: 'internal:role=button[name="Edit"i] >> nth=1',
            },
            guards: [
              { selector: 'internal:role=button[name="Edit"i]', count: 2 },
            ],
            strategy: 'playwright-structure',
          },
        }),
      ],
    });
    expect(code).toContain('left: element.scrollWidth');
    expect(code).toContain('toHaveCount(2)');
    expect(code).toContain('click({ delay: 800 })');
    expect(code).not.toContain('@midscene');
  });

  it('keeps drag endpoints and contenteditable selection in the native script', () => {
    const code = compileRecorderNativePlaywright({
      events: [
        event({
          type: 'drag',
          nativeTarget: {
            locator: { selector: '#source' },
            position: { x: 0.2, y: 0.5 },
            dropTarget: {
              locator: { selector: '#destination' },
              position: { x: 0.8, y: 0.5 },
            },
          },
        }),
        event({
          type: 'input',
          value: 'new',
          rawPayload: { mode: 'typeOnly' },
          nativeTarget: {
            locator: { selector: '[contenteditable]' },
            editable: true,
            contentEditableSelection: { start: 1, end: 4 },
          },
        }),
      ],
    });
    expect(code).toContain('target1.dragTo(drop1');
    expect(code).toContain('el.clientWidth * 0.8');
    expect(code).toContain('range.setStart(...boundary(1))');
    expect(code).toContain('range.setEnd(...boundary(4))');
    expect(code).toContain('target2.pressSequentially("new")');
  });

  it('supports scoped Ant Design subtargets and literal text containing regex metacharacters', () => {
    const code = compileRecorderNativePlaywright({
      events: [
        event({
          nativeTarget: {
            locator: {
              selector: '.ant-select[label="所属工厂"] .ant-select-clear',
            },
          },
        }),
        event({
          nativeTarget: { locator: { selector: 'button', text: '查询 (a+b)' } },
        }),
      ],
    });
    expect(code).toContain('.ant-select-clear');
    expect(code).toContain('toHaveCount(1)');
    expect(code).toContain('a\\\\+b');
  });

  it('does not include input values in DOM capture scripts', () => {
    const script = buildRecorderNativeCaptureScript({
      actionType: 'Input',
      mode: 'typeOnly',
      value: 'secret-value',
    });
    expect(script).not.toContain('secret-value');
    expect(script).toContain('document.activeElement');
  });

  it('exports visibility, scoped fields and relative descendant labels consistently', () => {
    const expression = recorderNativeLocatorExpression({
      selector: 'input[role="combobox"]',
      visible: true,
      scope: {
        selector: '.ant-form-item',
        visible: true,
        has: { selector: 'label', text: '所属工厂' },
        scope: {
          selector: '.ant-modal-content',
          visible: true,
          has: { selector: '.ant-modal-title', text: '编辑订单' },
        },
      },
    });
    expect(expression).toContain(
      'page.locator(".ant-modal-content").filter({ visible: true })',
    );
    expect(expression).toContain('.filter({ has: page.locator("label")');
    expect(expression).toContain(
      '.locator("input[role=\\"combobox\\"]").filter({ visible: true })',
    );
    expect(expression).not.toContain('.first()');
  });
});
