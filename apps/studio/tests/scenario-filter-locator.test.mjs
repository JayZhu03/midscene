import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  connectScenarioPage,
  executeScenarioNative,
} from '../../../packages/playground/src/scenario-native';
import {
  ScenarioRunner,
  validateScenarioRun,
} from '../../../packages/playground/src/scenario-runner';
import {
  buildRecorderNativeCaptureScript,
  compileRecorderNativePlaywright,
} from '../../../packages/shared/src/recorder-native';
import { buildScenarioRun } from '../src/renderer/components/StudioScenarios/sequence';

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

// Both the page and its picker have the same filter controls. Their generated
// container IDs change on remount; labels and dialog identity remain stable.
function filter(id, collapsed = true) {
  return `<div id="${id}" class="filter-form-wrapper">
    <form>
      <div class="ant-form-item"><div class="ant-form-item-label"><label>名称</label></div><input label="名称" placeholder="请输入(多值用逗号分隔)"></div>
      <div class="ant-form-item" data-code-field ${collapsed ? 'hidden' : ''}><div class="ant-form-item-label"><label>编码</label></div><input label="编码" placeholder="请输入(多值用逗号分隔)"></div>
      <button type="button" onclick="this.closest('form').querySelector('output').textContent=this.closest('form').querySelector('input[label=编码]').value"><span>查询</span></button><output></output>
    </form>
    <button type="button" class="filter-form-collapse-button" aria-label="${collapsed ? '展开' : '收起'}筛选条件" onclick="const field=this.parentElement.querySelector('[data-code-field]');field.hidden=!field.hidden;this.setAttribute('aria-label',(field.hidden?'展开':'收起')+'筛选条件');"><svg width="20" height="20"><path d="M2 4L10 12L18 4" stroke="black" fill="none"/></svg></button>
  </div>`;
}
function picker(id = 'filter-form-r5kdux', title = '选择物料') {
  return `<section class="ant-modal-content" style="position:relative"><header class="ant-modal-header"><div class="ant-modal-title">${title}</div></header>${filter(id)}</section>`;
}
function fixture(content = picker()) {
  return `<style>body{display:flex;gap:24px}section{width:360px;border:1px solid #aaa;padding:12px}input{width:260px;height:24px}button{height:28px}[hidden]{display:none!important}</style><section>${filter('filter-form-hiw8ul', false)}</section>${content}`;
}
function operation(type, nativeTarget, description, value, index = 0) {
  const event = {
    hashId: `filter-${index}`,
    type,
    source: 'studio-preview',
    actionType: { click: 'Tap', input: 'Input', keydown: 'KeyboardPress' }[
      type
    ],
    pageInfo: { width: 1200, height: 900 },
    timestamp: 1,
    nativeTarget,
    ...(value !== undefined ? { value } : {}),
    semantic: { elementDescription: description },
  };
  return {
    id: event.hashId,
    type: 'playwright-operation',
    description,
    event,
    operationIndex: index,
    code: compileRecorderNativePlaywright({
      events: [event],
      format: 'operation',
      stepOffset: index,
      sensitiveInputs: 'recorded',
      navigationMode: 'scenario',
    }),
  };
}
function legacySteps(title = '选择物料') {
  const scope = { selector: 'div[id="filter-form-uyriz4"]', visible: true };
  const input = {
    editable: true,
    strategy: 'context',
    locator: {
      selector: 'input[placeholder="请输入(多值用逗号分隔)"]',
      visible: true,
      scope: {
        selector: '.ant-form-item',
        visible: true,
        scope,
        has: { selector: '.ant-form-item-label label', text: '编码' },
      },
    },
  };
  return [
    operation(
      'click',
      {
        strategy: 'context',
        locator: {
          selector: 'button[aria-label="展开筛选条件"]',
          visible: true,
          scope,
        },
      },
      `点击“${title}”弹窗的展开筛选条件按钮`,
    ),
    operation('click', input, `点击“${title}”弹窗的“编码”输入框`, undefined, 1),
    ...['Q', 'QC', 'QC26-MAT-E2E-PACK'].map((value, i) =>
      operation(
        'input',
        input,
        `填写“${title}”弹窗的“编码”输入框`,
        value,
        i + 2,
      ),
    ),
    operation(
      'keydown',
      input,
      `在“${title}”弹窗的“编码”输入框中按End`,
      'End',
      5,
    ),
    operation(
      'click',
      {
        strategy: 'context',
        locator: {
          selector: 'button[aria-label="收起筛选条件"]',
          visible: true,
          scope,
        },
      },
      `点击“${title}”弹窗的收起筛选条件按钮`,
      undefined,
      6,
    ),
  ];
}
function plan(steps) {
  // Exercise the same saved-script -> execution request -> server boundary as
  // Studio, including its metadata allowlist. Directly passing events missed a
  // regression where source was lost and legacy locator adaptation was skipped.
  return JSON.parse(
    JSON.stringify(
      buildScenarioRun(
        'filters',
        [
          {
            id: 'picker',
            name: '选择物料',
            sourceSession: {
              target: { platformId: 'web', values: {} },
              events: steps.map((step) => step.event),
            },
            steps: steps.map(({ event, ...step }) => ({
              ...step,
              sourceEvent: event,
            })),
          },
        ],
        [],
      ),
    ),
  );
}
async function capture(page, selector, actionType = 'Tap') {
  const point = await page.$eval(selector, (element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  const result = await page.evaluate(
    buildRecorderNativeCaptureScript({ actionType, ...point }),
  );
  expect(result.error).toBeUndefined();
  expect(result.locator).toBeDefined();
  return result;
}

describe('filter picker locator stability', () => {
  it.each(['选择物料', '选择工艺路线'])(
    'records %s controls without the temporary container ID and replays after remount',
    async (title) => {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 900 });
      await page.setContent(fixture(picker('filter-form-uyriz4', title)));
      const signal = new AbortController().signal;
      const connection = await connectScenarioPage(
        { underlyingPage: page },
        signal,
      );
      try {
        const expand = await capture(
          page,
          '.ant-modal-content .filter-form-collapse-button',
        );
        await page.click('.ant-modal-content .filter-form-collapse-button');
        const input = await capture(
          page,
          '.ant-modal-content input[label="编码"]',
          'Input',
        );
        const collapse = await capture(
          page,
          '.ant-modal-content .filter-form-collapse-button',
        );
        const steps = [
          operation('click', expand, `展开“${title}”筛选条件`),
          operation(
            'input',
            input,
            `填写“${title}”编码`,
            'QC26-MAT-E2E-PACK',
            1,
          ),
          operation('click', collapse, `收起“${title}”筛选条件`, undefined, 2),
        ];
        expect(
          JSON.stringify(steps.map((s) => s.event.nativeTarget.locator)),
        ).not.toContain('filter-form-uyriz4');
        for (const generation of ['r5kdux', 'c3tte6']) {
          await page.setContent(
            fixture(picker(`filter-form-${generation}`, title)),
          );
          for (const s of steps)
            await executeScenarioNative(connection.page, s, signal, 0);
          expect(
            await page.$eval(
              '.ant-modal-content input[label="编码"]',
              (el) => el.value,
            ),
          ).toBe('QC26-MAT-E2E-PACK');
          expect(
            await page.$eval(
              'body > section input[label="编码"]',
              (el) => el.value,
            ),
          ).toBe('');
        }
        await page.setContent(fixture(picker('filter-form-k4le92', title)));
        for (const s of steps)
          await new AsyncFunction('page', 'expect', s.code)(
            connection.page,
            playwrightExpect,
          );
        expect(
          await page.$eval(
            '.ant-modal-content input[label="编码"]',
            (el) => el.value,
          ),
        ).toBe('QC26-MAT-E2E-PACK');
      } finally {
        await connection.close();
        await page.close();
      }
    },
    30000,
  );

  it('replays existing expansion, clicks, consecutive input and keyboard steps without Agent or modifying saved code', async () => {
    const page = await browser.newPage();
    const signal = new AbortController().signal;
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      signal,
    );
    try {
      const input = plan(legacySteps());
      const saved = structuredClone(input);
      validateScenarioRun(input);
      for (const generation of ['r5kdux', 'c3tte6']) {
        await page.setContent(fixture(picker(`filter-form-${generation}`)));
        const runner = new ScenarioRunner(input);
        const recover = vi.fn(async () => false);
        await runner.run(
          (s, signal, index) =>
            executeScenarioNative(connection.page, s, signal, index),
          { recover },
        );
        expect(runner.state.status).toBe('completed');
        expect(recover).not.toHaveBeenCalled();
        expect(
          await page.$eval(
            '.ant-modal-content input[label="编码"]',
            (el) => el.value,
          ),
        ).toBe('QC26-MAT-E2E-PACK');
        expect(
          await page.$eval(
            'body > section input[label="编码"]',
            (el) => el.value,
          ),
        ).toBe('');
        expect(runner.state.scripts[0].steps[0].detail).toContain('选择物料');
      }
      expect(input).toEqual(saved);
    } finally {
      await connection.close();
      await page.close();
    }
  }, 30000);

  it('returns to native input after just the expansion step needs recovery', async () => {
    const page = await browser.newPage();
    await page.setContent(fixture());
    const signal = new AbortController().signal;
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      signal,
    );
    try {
      const input = plan(legacySteps());
      const recover = vi.fn(async () => {
        await page.click('.ant-modal-content .filter-form-collapse-button');
        return true;
      });
      const runner = new ScenarioRunner(input);
      await runner.run(
        (s, signal, index) => {
          if (s.id === input.scripts[0].steps[0].id)
            throw new Error('Expansion needs recovery');
          return executeScenarioNative(connection.page, s, signal, index);
        },
        { recover },
      );
      expect(runner.state.status).toBe('completed');
      expect(recover).toHaveBeenCalledTimes(1);
      expect(
        runner.state.scripts[0].steps.filter((s) => s.recovery),
      ).toHaveLength(1);
      expect(
        await page.$eval(
          '.ant-modal-content input[label="编码"]',
          (el) => el.value,
        ),
      ).toBe('QC26-MAT-E2E-PACK');
    } finally {
      await connection.close();
      await page.close();
    }
  }, 30000);

  it('rebinds the recorded picker after its parent detail receives a new view token', async () => {
    const page = await browser.newPage();
    const base = 'http://detail.test/app/#/object-detail/';
    const recorded = `${base}object-detail-1792131578759-56ydmi2o?from=%2Forders`;
    const live = `${base}object-detail-1792134966120-9x684516?from=%2Forders`;
    await page.setRequestInterception(true);
    page.on('request', (request) =>
      request.respond({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: fixture(),
      }),
    );
    await page.goto(live);
    expect(
      await page.$eval('.ant-modal-title', (node) => node.textContent),
    ).toBe('选择物料');
    const signal = new AbortController().signal;
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      signal,
    );
    try {
      const steps = legacySteps();
      for (const s of steps) s.event.url = recorded;
      const input = plan(steps);
      const runner = new ScenarioRunner(input);
      const recover = vi.fn(async () => false);
      await runner.run(
        (s, signal, index) =>
          executeScenarioNative(connection.page, s, signal, index),
        { recover },
      );
      expect(runner.state.status).toBe('completed');
      expect(recover).not.toHaveBeenCalled();
      expect(
        await connection.page
          .locator('.ant-modal-content input[label="编码"]')
          .inputValue(),
      ).toBe('QC26-MAT-E2E-PACK');
      expect(
        await connection.page
          .locator('body > section:not(.ant-modal-content) input[label="编码"]')
          .inputValue(),
      ).toBe('');
    } finally {
      await connection.close();
      await page.close();
    }
  }, 20000);

  it.each([
    'wrong-dialog',
    'wrong-route',
    'partial-title',
    'duplicate-dialog',
    'original-ambiguous',
    'duplicate-filter',
    'hidden-dialog',
    'background-only',
    'stable-id',
    'other-source',
    'no-recorded-title',
    'missing-control',
  ])('does not guess or broaden the target for %s', async (variant) => {
    const page = await browser.newPage();
    let content = picker();
    const s = legacySteps()[0];
    if (variant === 'wrong-dialog')
      content = picker('filter-form-c3tte6', '选择工艺路线');
    if (variant === 'wrong-route') s.event.url = 'http://127.0.0.1/other-page';
    if (variant === 'partial-title')
      content = picker('filter-form-c3tte6', '物料');
    if (variant === 'duplicate-dialog') content += picker('filter-form-c3tte6');
    if (variant === 'original-ambiguous')
      content = picker('filter-form-uyriz4') + picker('filter-form-uyriz4');
    if (variant === 'duplicate-filter')
      content = content.replace(
        '</section>',
        `${filter('filter-form-c3tte6')}</section>`,
      );
    if (variant === 'hidden-dialog') content = `<div hidden>${content}</div>`;
    if (variant === 'background-only') content = '';
    if (variant === 'stable-id')
      s.event.nativeTarget.locator.scope.selector =
        'div[id="filter-form-orders-list"]';
    if (variant === 'other-source') s.event.source = 'unsupported';
    if (variant === 'no-recorded-title') {
      s.description = '点击展开筛选条件';
      s.event.semantic.elementDescription = s.description;
    }
    if (variant === 'missing-control')
      s.event.nativeTarget.locator.selector = 'button[aria-label="missing"]';
    await page.setContent(fixture(content));
    const abort = new AbortController();
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      abort.signal,
    );
    const timer = setTimeout(
      () => abort.abort(new Error('Stopped unsafe locator check')),
      350,
    );
    try {
      await expect(
        executeScenarioNative(connection.page, s, abort.signal, 0),
      ).rejects.toThrow();
      expect(
        await page.$$eval('input', (nodes) =>
          nodes.every((n) => n.value === ''),
        ),
      ).toBe(true);
      expect(
        await page.$$eval(
          '[data-code-field]:not([hidden])',
          (nodes) => nodes.length,
        ),
      ).toBe(1);
    } finally {
      clearTimeout(timer);
      await connection.close().catch(() => {});
      await page.close();
    }
  });
});
