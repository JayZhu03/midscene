import { createRequire } from 'node:module';
import {
  buildRecorderNativeCaptureScript,
  compileRecorderNativePlaywright,
} from '@midscene/shared/recorder-native';
import puppeteer from 'puppeteer';
import ts from 'typescript';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  connectScenarioPage,
  executeScenarioNative,
} from '../../../packages/playground/src/scenario-native';

const require = createRequire(
  new URL('../../../packages/web-integration/package.json', import.meta.url),
);
const { expect: playwrightExpect } = require('@playwright/test');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
let browser;
beforeAll(async () => {
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => {
  await browser?.close();
});

const form = () => `
  <input placeholder="订单编号">
  <button onclick="document.querySelector('output').textContent=document.querySelector('input').value">保存 (A+B)[1]</button>
  <button hidden>保存 (A+B)[1]</button>
  <output></output>
  <div class="ant-form-item">
    <div class="ant-form-item-label"><label>所属工厂</label></div>
    <div class="ant-select">
      <span class="ant-select-selection-item">工厂A</span>
      <span class="ant-select-clear" style="display:inline-block;width:16px;height:16px" onmousedown="document.querySelector('.ant-select-selection-item').textContent='';document.body.dataset.cleared='yes'">×</span>
      <span class="ant-select-arrow" style="display:inline-block;width:16px;height:16px" onclick="document.querySelector('[role=listbox]').hidden=false">↓</span>
    </div>
    <div role="listbox" hidden><div role="option" onclick="document.querySelector('.ant-select-selection-item').textContent=this.textContent;this.parentElement.hidden=true">工厂B</div></div>
  </div>
  <table>
    <thead><tr><th><input type="checkbox" aria-label="全选" onchange="document.body.dataset.selectAll=String(this.checked)"></th><th>订单</th><th>数量</th><th>操作</th></tr></thead>
    <tbody>
      ${['PO-1001', 'PO-1002'].map((order) => `<tr data-row-key="${order}"><td><label class="ant-checkbox-wrapper"><input type="checkbox"></label></td><td><a>${order}</a></td><td><input placeholder="数量"></td><td><button onclick="document.body.dataset.edited='${order}'">编辑</button></td></tr>`).join('')}
    </tbody>
  </table>
  <table><tbody><tr><td><input aria-label="备注"></td></tr></tbody></table>
  <div class="ant-modal-content"><div class="ant-modal-title">编辑订单</div><input placeholder="数量"></div>
  <button id="special" ondblclick="document.body.dataset.double='yes'" oncontextmenu="event.preventDefault();document.body.dataset.right='yes'">更多操作</button>
  <div id="scroll" style="height:60px;overflow:auto"><div style="height:500px">内容</div></div>
  <div id="drag" draggable="true" style="width:80px;height:30px">拖动</div>
  <div id="drop" style="width:100px;height:40px" ondragover="event.preventDefault()" ondrop="event.preventDefault();document.body.dataset.dropped='yes'">目标</div>
`;

async function capture(page, selector, actionType, extra = {}) {
  await page.$eval(selector, (node) => node.scrollIntoView());
  if (actionType === 'Input' || actionType === 'KeyboardPress')
    await page.focus(selector);
  const point = await page.$eval(selector, (node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  const nativeTarget = await page.evaluate(
    buildRecorderNativeCaptureScript({ actionType, ...point, ...extra }),
  );
  expect(nativeTarget.error).toBeUndefined();
  expect(nativeTarget.locator).toBeDefined();
  return nativeTarget;
}

it('keeps ordinary recorded controls working through runtime replay and exported Playwright code', async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 900 });
  await page.setContent(form());
  const signal = new AbortController().signal;
  const connection = await connectScenarioPage(
    { underlyingPage: page },
    signal,
  );
  const steps = [];
  const record = async (selector, type, actionType, extra = {}) => {
    const nativeTarget = await capture(
      page,
      selector,
      actionType,
      extra.rawPayload,
    );
    const event = {
      hashId: `regression-${steps.length}`,
      timestamp: 1,
      pageInfo: { width: 1000, height: 900 },
      type,
      actionType,
      nativeTarget,
      ...extra,
    };
    if (type === 'drag')
      nativeTarget.dropTarget = await capture(page, '#drop', 'DragAndDrop');
    const step = {
      id: event.hashId,
      type: 'playwright-operation',
      description: actionType,
      event,
      operationIndex: steps.length,
      code: compileRecorderNativePlaywright({
        events: [event],
        platformId: 'web',
        format: 'operation',
        stepOffset: steps.length,
      }),
    };
    steps.push(step);
    await executeScenarioNative(connection.page, step, signal, 0);
  };
  const check = async () => {
    expect(await page.$eval('output', (node) => node.textContent)).toBe(
      'sUPER',
    );
    expect(
      await page.$eval(
        '.ant-select-selection-item',
        (node) => node.textContent,
      ),
    ).toBe('工厂B');
    expect(
      await page.$eval(
        '[data-row-key="PO-1001"] input[type=checkbox]',
        (node) => node.checked,
      ),
    ).toBe(false);
    expect(
      await page.$eval(
        '[data-row-key="PO-1002"] input[type=checkbox]',
        (node) => node.checked,
      ),
    ).toBe(true);
    expect(
      await page.$eval(
        '[data-row-key="PO-1002"] input[placeholder]',
        (node) => node.value,
      ),
    ).toBe('25');
    expect(
      await page.$eval('input[aria-label="备注"]', (node) => node.value),
    ).toBe('备注正确');
    expect(
      await page.$eval('.ant-modal-content input', (node) => node.value),
    ).toBe('30');
    expect(await page.$eval('#scroll', (node) => node.scrollTop)).toBe(150);
    expect(
      await page.evaluate(() => ({ ...document.body.dataset })),
    ).toMatchObject({
      cleared: 'yes',
      selectAll: 'true',
      edited: 'PO-1002',
      double: 'yes',
      right: 'yes',
      dropped: 'yes',
    });
  };
  try {
    await record('input[placeholder="订单编号"]', 'input', 'Input', {
      value: 'AB',
    });
    await record('input[placeholder="订单编号"]', 'input', 'Input', {
      value: 'C',
      rawPayload: { mode: 'typeOnly' },
    });
    expect(
      await page.$eval('input[placeholder="订单编号"]', (node) => node.value),
    ).toBe('ABC');
    await record('input[placeholder="订单编号"]', 'keydown', 'KeyboardPress', {
      value: 'ControlOrMeta+A',
    });
    await record('input[placeholder="订单编号"]', 'input', 'Input', {
      value: 'sUPER',
    });
    await record('body > button', 'click', 'Tap');
    await record('.ant-select-clear', 'click', 'Tap');
    await record('.ant-select-arrow', 'click', 'Tap');
    await record('[role="option"]', 'click', 'Tap');
    await record('thead input', 'click', 'Tap');
    await record(
      '[data-row-key="PO-1002"] input[type=checkbox]',
      'click',
      'Tap',
    );
    await record(
      '[data-row-key="PO-1002"] input[placeholder]',
      'input',
      'Input',
      { value: '25' },
    );
    await record('[data-row-key="PO-1002"] button', 'click', 'Tap');
    await record('input[aria-label="备注"]', 'input', 'Input', {
      value: '备注正确',
    });
    await record('.ant-modal-content input', 'input', 'Input', { value: '30' });
    await record('#special', 'click', 'DoubleClick');
    await record('#special', 'click', 'RightClick');
    await record('#scroll', 'scroll', 'Scroll', {
      rawPayload: {
        scrollType: 'singleAction',
        direction: 'down',
        distance: 150,
      },
    });
    await record('#drag', 'drag', 'DragAndDrop');
    await check();

    for (const mode of ['runtime', 'compiled']) {
      await page.setContent(form());
      for (const step of JSON.parse(JSON.stringify(steps))) {
        if (mode === 'runtime')
          await executeScenarioNative(connection.page, step, signal, 0);
        else {
          const code = ts.transpileModule(step.code, {
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
            },
          }).outputText;
          await new AsyncFunction('page', 'expect', code)(
            connection.page,
            playwrightExpect,
          );
        }
      }
      await check();
    }
  } finally {
    await connection.close();
    await page.close();
  }
}, 45000);
