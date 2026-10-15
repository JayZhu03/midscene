import type { MidsceneRecorderNativeLocator } from '@midscene/shared/recorder';
import { captureRecorderNativeTarget } from '@midscene/shared/recorder-native-capture';
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionTaskTable } from './fixtures/production-task-table';

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
        (!recipe.generatedText ||
          (() => {
            const text = node.textContent?.replace(/\s+/g, ' ').trim() || '';
            const { prefix, suffix } = recipe.generatedText;
            return (
              text.startsWith(prefix) &&
              text.endsWith(suffix) &&
              /^\d+$/.test(
                text.slice(prefix.length, text.length - suffix.length),
              )
            );
          })()) &&
        (!recipe.has || matches(recipe.has, node).length > 0) &&
        (recipe.hasAll || []).every((child) => matches(child, node).length > 0),
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

  it('preserves a table-header select-all control without requiring a business-row identity', () => {
    document.body.innerHTML =
      '<table><thead><tr><th><label class="ant-checkbox-wrapper" aria-label="全选"><input type="checkbox"></label></th><th>订单</th></tr></thead><tbody><tr data-row-key="PO-1"><td><label class="ant-checkbox-wrapper"><input type="checkbox"></label></td><td>PO-1</td></tr></tbody></table>';
    const target = capture('thead input');
    expect(target.error).toBeUndefined();
    expect(matches(target.locator!)).toEqual([
      document.querySelector('thead label'),
    ]);
  });

  it('preserves unique fields inside layout tables without business rows', () => {
    document.body.innerHTML =
      '<table><tbody><tr><td><input aria-label="备注"></td></tr></tbody></table>';
    expectTarget('input');
  });

  it.each(['data-testid', 'id'])(
    'preserves an explicit %s on a control inside a changing business row',
    (attribute) => {
      document.body.innerHTML = `<div data-row-key="28071568469524480"><div role="cell"><input ${attribute}="planned-quantity"></div><div role="cell">PO-1234</div></div>`;
      const target = expectTarget('input');
      expect(target.strategy).toBe('attribute');
      document
        .querySelector('[data-row-key]')!
        .setAttribute('data-row-key', '9999999999999');
      document.querySelector('[role="cell"]:last-child')!.textContent =
        'PO-5678';
      expect(matches(target.locator!)).toEqual([
        document.querySelector('input'),
      ]);
    },
  );

  it('selects the same operation after task IDs and manufacturing-order codes regenerate', () => {
    document.body.innerHTML = productionTaskTable();
    const target = capture('[data-operation="20"]');
    expect(target.locator).toBeDefined();
    document.body.innerHTML = productionTaskTable({
      generation: 277,
      operations: [40, 30, 10, 20],
      status: '已派工',
    });
    expect(matches(target.locator!)).toEqual([
      document.querySelector('[data-operation="20"]')!.closest('label'),
    ]);
  });

  it('does not match a different production order or guess between duplicate operations', () => {
    document.body.innerHTML = productionTaskTable();
    const target = capture('[data-operation="20"]');
    document.body.innerHTML = productionTaskTable({ order: 'MO-M04-018' });
    expect(matches(target.locator!)).toEqual([]);
    document.body.innerHTML =
      productionTaskTable({ generation: 277 }) +
      productionTaskTable({ generation: 278 });
    expect(matches(target.locator!)).toHaveLength(2);
  });

  it('retains order context when only one task checkbox is visible', () => {
    document.body.innerHTML = productionTaskTable({ operations: [20] });
    const target = capture('[data-operation="20"]');
    document.body.innerHTML = productionTaskTable({
      order: 'MO-M04-018',
      operations: [20],
    });
    expect(matches(target.locator!)).toEqual([]);
  });

  it('supports React-created td cells under virtual div rows', () => {
    document.body.innerHTML = productionTaskTable();
    for (const cell of document.querySelectorAll('[role="cell"]')) {
      const td = document.createElement('td');
      td.innerHTML = cell.innerHTML;
      cell.replaceWith(td);
    }
    const target = capture('[data-operation="30"]');
    document.querySelectorAll('[data-row-key]').forEach((row) => {
      row.setAttribute(
        'data-row-key',
        row.getAttribute('data-row-key')!.replace('274', '277'),
      );
      row.querySelectorAll('a').forEach((link) => {
        link.textContent = link.textContent!.replace('0274', '0277');
      });
    });
    expect(matches(target.locator!)).toEqual([
      document.querySelector('[data-operation="30"]')!.closest('label'),
    ]);
  });

  it('preserves first-column selection with nested span codes, repeated columns and disabled business checkboxes', () => {
    function render(generation: number, operations: number[]) {
      document.body.innerHTML = productionTaskTable({
        generation,
        operations,
        codeMarkup: 'nested',
        extraCheckboxes: true,
      });
      // React can create div > td; HTML parsing alone drops these cells.
      for (const cell of document.querySelectorAll('[role="cell"]')) {
        const td = document.createElement('td');
        td.innerHTML = cell.innerHTML;
        cell.replaceWith(td);
      }
    }
    render(274, [10, 20, 30, 40]);
    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(
      document.querySelector('[data-row-key]')!.querySelectorAll('input'),
    ).toHaveLength(11);
    const targets = [10, 20, 30, 40].map((operation) => ({
      operation,
      target: capture(`[data-operation="${operation}"]`),
    }));
    for (const { target } of targets) {
      expect(target.error).toBeUndefined();
      expect(JSON.stringify(target.locator)).toContain('generatedText');
    }
    render(280, [40, 30, 20, 10]);
    for (const { operation, target } of targets)
      expect(matches(target.locator!)).toEqual([
        document
          .querySelector(`[data-operation="${operation}"]`)!
          .closest('label'),
      ]);
  });

  it('preserves the complete business prefix and exact operation suffix', () => {
    document.body.innerHTML = productionTaskTable();
    const target = capture('[data-operation="20"]');
    document.body.innerHTML = productionTaskTable({ operations: [120] });
    expect(matches(target.locator!)).toEqual([]);
    document.body.innerHTML = productionTaskTable().replace(
      /MO-MO-M04-017-/g,
      'OTHER-MO-M04-017-',
    );
    expect(matches(target.locator!)).toEqual([]);
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

  it('does not generalize a numeric code without corroborating parent and order labels', () => {
    document.body.innerHTML = productionTaskTable();
    document.querySelectorAll('[role="cell"] > a').forEach((link) => {
      if (link.textContent === 'MO-MO-M04-017-0274') link.remove();
    });
    const target = capture('[data-operation="20"]');
    expect(JSON.stringify(target.locator)).not.toContain('generatedText');
    document.body.innerHTML = productionTaskTable({ generation: 277 });
    expect(matches(target.locator!)).toEqual([]);
  });

  it('uses an exact rendered row key when an opaque ID changes independently', () => {
    document.body.innerHTML =
      '<div data-row-key="28071568469524480"><div role="cell"><label class="ant-checkbox-wrapper"><input></label></div><div role="cell"><a>PO-1234</a></div></div><div data-row-key="28071568469524481"><div role="cell"><label class="ant-checkbox-wrapper"><input></label></div><div role="cell"><a>PO-5678</a></div></div>';
    const target = capture('[data-row-key="28071568469524481"] input');
    document
      .querySelector('[data-row-key="28071568469524481"]')!
      .setAttribute('data-row-key', '9999999999999');
    expect(matches(target.locator!)).toEqual([
      document.querySelector('[data-row-key="9999999999999"] label'),
    ]);
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
