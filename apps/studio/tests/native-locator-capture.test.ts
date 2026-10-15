import type { MidsceneRecorderNativeLocator } from '@midscene/shared/recorder';
import { captureRecorderNativeTarget } from '@midscene/shared/recorder-native-capture';
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no layout. Model only visibility and the known pointer hit; all
// locator queries still run against real, independently constructed DOM trees.
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (
    this: Element,
  ) {
    const hidden = this.closest(
      '[hidden], [style*="display:none"], [style*="display: none"]',
    );
    return (hidden
      ? []
      : [{ width: 40, height: 20 }]) as unknown as DOMRectList;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function capture(selector: string) {
  const hit = document.querySelector(selector)!;
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => hit,
  });
  return captureRecorderNativeTarget({ actionType: 'Tap', x: 10, y: 10 });
}
function matches(
  recipe: MidsceneRecorderNativeLocator,
  root: Document | Element = document,
): Element[] {
  const roots = recipe.scope ? matches(recipe.scope, root) : [root];
  return roots
    .flatMap((scope) => Array.from(scope.querySelectorAll(recipe.selector)))
    .filter(
      (node) =>
        (!recipe.visible ||
          (node.getClientRects().length > 0 &&
            getComputedStyle(node).visibility !== 'hidden')) &&
        (!recipe.text ||
          node.textContent?.replace(/\s+/g, ' ').trim() === recipe.text) &&
        (!recipe.has || matches(recipe.has, node).length > 0),
    );
}
function expectTarget(selector: string) {
  const target = capture(selector);
  expect(target.error).toBeUndefined();
  expect(target.locator).toBeDefined();
  expect(matches(target.locator!)).toEqual([document.querySelector(selector)]);
  return target;
}
const field = (content: string) =>
  `<div class="ant-form-item"><div class="ant-form-item-label"><label>所属工厂</label></div>${content}</div>`;
const card = (title: string, content: string) =>
  `<div class="ant-card"><div class="ant-card-head-title">${title}</div>${content}</div>`;

describe('native DOM recording on complex pages', () => {
  it('uses the focused shadow input for typing even when a stale pointer is provided', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const root = document
      .querySelector('#host')!
      .attachShadow({ mode: 'open' });
    root.innerHTML = '<input aria-label="内部字段">';
    const input = root.querySelector('input')!;
    input.focus();
    const fallback = vi.fn(() => ({
      locator: { selector: 'input[aria-label="内部字段"]' },
    }));
    const result = captureRecorderNativeTarget(
      { actionType: 'Input', mode: 'typeOnly', x: 999, y: 999 },
      fallback,
    );
    expect(fallback).toHaveBeenCalledWith(input);
    expect(result.editable).toBe(true);
    expect(result.selection).toMatchObject({ start: 0, end: 0 });
  });

  it('ignores hidden duplicate controls and CSS-hidden controls', () => {
    document.body.innerHTML =
      '<input placeholder="订单编号"><div hidden><input placeholder="订单编号"></div><input placeholder="订单编号" style="visibility:hidden">';
    expectTarget('body > input:first-child');
  });

  it('follows vertical scroll chaining instead of recording an exhausted inner container', () => {
    document.body.innerHTML =
      '<div id="outer" style="overflow-y:auto"><div id="inner" style="overflow-y:auto"><span>内容</span></div></div>';
    const outer = document.querySelector('#outer')!;
    const inner = document.querySelector('#inner')!;
    for (const node of [outer, inner]) {
      Object.defineProperty(node, 'scrollHeight', { value: 500 });
      Object.defineProperty(node, 'clientHeight', { value: 100 });
    }
    inner.scrollTop = 400;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => inner.firstElementChild,
    });
    const result = captureRecorderNativeTarget({
      actionType: 'Scroll',
      x: 10,
      y: 10,
      direction: 'down',
      scrollType: 'singleAction',
    });
    expect(matches(result.locator!)).toEqual([outer]);
    const up = captureRecorderNativeTarget({
      actionType: 'Scroll',
      x: 10,
      y: 10,
      direction: 'up',
      scrollType: 'singleAction',
    });
    expect(matches(up.locator!)).toEqual([inner]);
  });

  it('distinguishes repeated labels across deeply nested cards', () => {
    const deep =
      '<div>'.repeat(10) +
      field('<input placeholder="请选择">') +
      '</div>'.repeat(10);
    document.body.innerHTML = card('生产订单', deep) + card('采购订单', deep);
    expectTarget('.ant-card:nth-child(2) input');
  });

  it('keeps keyed table actions on the same business row after row reordering', () => {
    const rows =
      '<tbody><tr data-row-key="PO-1"><td>PO-1</td><td><button>编辑</button></td></tr><tr data-row-key="PO-2"><td>PO-2</td><td><button>编辑</button></td></tr></tbody>';
    document.body.innerHTML =
      card('生产订单', `<table>${rows}</table>`) +
      card('采购订单', `<table>${rows}</table>`);
    const target = expectTarget(
      '.ant-card:nth-child(2) tr[data-row-key="PO-2"] button',
    );
    const expected = document.querySelector(
      '.ant-card:nth-child(2) tr[data-row-key="PO-2"] button',
    );
    document
      .querySelectorAll('tbody')
      .forEach((body) => body.prepend(body.lastElementChild!));
    expect(matches(target.locator!)).toEqual([expected]);
  });

  it('keeps a button label stable when its badge count changes', () => {
    document.body.innerHTML =
      '<button><span>查询</span><sup class="ant-badge">1</sup></button>';
    const target = expectTarget('button');
    document.querySelector('sup')!.textContent = '200';
    expect(matches(target.locator!)).toEqual([
      document.querySelector('button'),
    ]);
  });

  it('distinguishes two comboboxes within the same field using a scoped structural path', () => {
    const controls = field(
      '<div><input role="combobox"><input role="combobox"></div>',
    );
    document.body.innerHTML =
      card('生产订单', controls) + card('采购订单', controls);
    const target = expectTarget('.ant-card:nth-child(2) input:nth-child(2)');
    expect(target.strategy).toBe('structure');
  });

  it('preserves clear and arrow subcontrols instead of promoting them to the select', () => {
    document.body.innerHTML = field(
      '<div class="ant-select"><span class="ant-select-clear"><svg></svg></span><span class="ant-select-arrow"><svg></svg></span></div>',
    );
    const clear = capture('.ant-select-clear svg');
    const arrow = capture('.ant-select-arrow svg');
    expect(matches(clear.locator!)).toEqual([
      document.querySelector('.ant-select-clear'),
    ]);
    expect(matches(arrow.locator!)).toEqual([
      document.querySelector('.ant-select-arrow'),
    ]);
  });

  it('records the clickable select control when the selected value overlays its input', () => {
    document.body.innerHTML = field(
      '<div class="ant-select-selector"><input role="combobox"><span title="工厂A">工厂A</span></div>',
    );
    const target = capture('span');
    expect(matches(target.locator!)).toEqual([
      document.querySelector('.ant-select-selector'),
    ]);
    document.querySelector('span')!.textContent = '工厂B';
    expect(matches(target.locator!)).toEqual([
      document.querySelector('.ant-select-selector'),
    ]);
  });

  it('uses a dialog title to distinguish fields with identical labels', () => {
    const modal = (title: string) =>
      `<div class="ant-modal-content"><div class="ant-modal-title">${title}</div>${field('<input placeholder="请选择">')}</div>`;
    document.body.innerHTML = modal('创建订单') + modal('编辑订单');
    expectTarget('.ant-modal-content:nth-child(2) input');
  });

  it('rejects identical actions with no distinguishing business context', () => {
    document.body.innerHTML =
      '<section id="orders"><button>查看</button><button>查看</button></section>';
    expect(capture('button')).toMatchObject({
      error: '无法唯一定位，请重新录制。',
    });
    expect(capture('button').locator).toBeUndefined();
  });
});
