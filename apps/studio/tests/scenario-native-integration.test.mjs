import { createServer } from 'node:http';
import {
  buildRecorderNativeCaptureScript,
  compileRecorderNativePlaywright,
  recorderNativeLocatorExpression,
} from '@midscene/shared/recorder-native';
import puppeteer from 'puppeteer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  connectScenarioPage,
  executeScenarioNative,
  waitForScenarioNavigation,
} from '../../../packages/playground/src/scenario-native';
import {
  scenarioNavigationEffect,
  scenarioNavigationMatches,
  scenarioRoute,
} from '../../../packages/playground/src/scenario-navigation';
import {
  ScenarioRunner,
  executeScenarioAgentStep,
  validateScenarioRun,
} from '../../../packages/playground/src/scenario-runner';
import { productionTaskTable } from './fixtures/production-task-table';

let browser;
let server;
let url;
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/detail-fixture')) {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        `<button id="open-detail" onclick="window.opens++;setTimeout(()=>{location.hash=window.detailRoute;document.body.innerHTML='<main aria-busy=true>Loading</main>';setTimeout(()=>{document.title='订单详情-ORDER-003';document.body.innerHTML='<main><h1>ORDER-003</h1><input id=comment></main>';},200);},100)"><span title="ORDER-003">ORDER-003</span></button><script>window.opens=0;window.detailRoute='/object-detail/object-detail-1792134966120-9x684516?from=%2Forders';</script>`,
      );
      return;
    }
    if (req.url?.startsWith('/spa')) {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        `<button id="expand" onclick="document.querySelector('#delayed').hidden=false">Plan menu</button><button id="delayed" onclick="setTimeout(() => { location.hash='/orders?run=current'; document.body.innerHTML='<main aria-busy=true>Loading</main>'; setTimeout(() => document.body.innerHTML='<main>Orders ready</main>', 300); }, 250)">Orders</button><button id="ineffective">No effect</button>`,
      );
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/orders?run=current' });
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<input id="value"><button onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#value\').value">Save</button><output id="result"></output><div id="scroll" style="height:100px;overflow:auto"><div style="height:1000px">Content</div></div>',
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/`;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

function step(type, extra = {}, index = 0) {
  const event = {
    hashId: `event-${index}`,
    type,
    timestamp: 1,
    pageInfo: { width: 900, height: 600 },
    ...extra,
  };
  return {
    id: event.hashId,
    type: 'playwright-operation',
    description: type,
    event,
    operationIndex: index,
    code: compileRecorderNativePlaywright({
      events: [event],
      platformId: 'web',
      format: 'operation',
      stepOffset: index,
    }),
  };
}

describe('shared Studio browser execution', () => {
  it('replays a generated detail route without Agent takeover and preserves the live detail for the next script', async () => {
    const page = await browser.newPage();
    const beforeUrl = `${url}detail-fixture#/orders`;
    const recorded = `${url}detail-fixture#/object-detail/object-detail-1792131578759-56ydmi2o?from=%2Forders`;
    const current = `${url}detail-fixture#/object-detail/object-detail-1792134966120-9x684516?from=%2Forders`;
    await page.goto(beforeUrl);
    const signal = new AbortController().signal;
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      signal,
    );
    try {
      const steps = [
        step('navigation', {
          actionType: 'Navigate',
          url: recorded,
          rawPayload: {
            implicitNavigationState: true,
            triggerActionType: 'SessionNavigation',
            beforeUrl,
            afterUrl: recorded,
          },
        }),
        step(
          'click',
          {
            actionType: 'Tap',
            url: beforeUrl,
            nativeTarget: {
              locator: { selector: 'span[title="ORDER-003"]', visible: true },
            },
          },
          1,
        ),
      ];
      const input = validateScenarioRun({
        scenarioId: 'details',
        scripts: [
          { id: 'a', name: '打开订单详情', startMode: 'automatic', steps },
          {
            id: 'b',
            name: '在详情中继续',
            startMode: 'automatic',
            steps: [
              step(
                'navigation',
                {
                  actionType: 'InitialNavigation',
                  url: `${recorded}&tab=properties`,
                },
                2,
              ),
              step(
                'input',
                {
                  value: 'same detail',
                  nativeTarget: {
                    editable: true,
                    locator: { selector: '#comment' },
                  },
                },
                3,
              ),
            ],
          },
        ],
      });
      const before = structuredClone(input);
      const bindings = new Map();
      const runner = new ScenarioRunner(input);
      const recover = vi.fn(async () => false);
      await runner.run(
        async (s, signal, index) => {
          if (s.event.actionType === 'InitialNavigation')
            await page.evaluate(() => {
              window.preservedDocument = true;
              location.hash += '&tab=execution';
            });
          return executeScenarioNative(connection.page, s, signal, index, {
            navigationEffect: scenarioNavigationEffect(
              input.scripts[index].steps,
              runner.state.stepIndex,
            ),
            navigationBindings: bindings,
            waitReady: connection.waitForAssertionReady,
          });
        },
        { recover },
      );
      expect(runner.state.status).toBe('completed');
      expect(recover).not.toHaveBeenCalled();
      expect(page.url()).toBe(`${current}&tab=execution`);
      expect(await page.evaluate(() => window.preservedDocument)).toBe(true);
      expect(await page.evaluate(() => window.opens)).toBe(1);
      expect(await connection.page.locator('#comment').inputValue()).toBe(
        'same detail',
      );
      expect(bindings.get(scenarioRoute(recorded))).toBe(current);
      expect(input).toEqual(before);
    } finally {
      await connection.close();
      await page.close();
    }
  }, 20000);

  it('uses a uniquely located live link for changed data IDs while keeping static route segments', async () => {
    const page = await browser.newPage();
    const beforeUrl = `${url}detail-fixture#/orders`;
    await page.goto(beforeUrl);
    await page.setContent(
      '<a href="#/orders/456/detail"><span id="live-order">Order</span></a>',
    );
    const signal = new AbortController().signal;
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      signal,
    );
    try {
      const effect = {
        beforeUrl,
        afterUrl: `${url}detail-fixture#/orders/123/detail`,
        observationStepId: 'data-detail',
      };
      await executeScenarioNative(
        connection.page,
        step('click', {
          actionType: 'Tap',
          nativeTarget: { locator: { selector: '#live-order' } },
        }),
        signal,
        0,
        { navigationEffect: effect },
      );
      expect(page.url()).toBe(`${url}detail-fixture#/orders/456/detail`);
      // The recovery recheck retains the SAME current-run link evidence.
      await expect(
        waitForScenarioNavigation(
          connection.page,
          effect,
          signal,
          undefined,
          150,
        ),
      ).resolves.toBeDefined();
      await page.evaluate(() => {
        location.hash = '/orders/789/detail';
      });
      // The Puppeteer action and Playwright observer have separate CDP queues.
      // Establish the fixture state before checking that this route is rejected.
      await connection.page.waitForURL(
        `${url}detail-fixture#/orders/789/detail`,
      );
      await expect(
        waitForScenarioNavigation(
          connection.page,
          effect,
          signal,
          undefined,
          150,
        ),
      ).rejects.toThrow('未切换');
    } finally {
      await connection.close();
      await page.close();
    }
  });

  it.each(['unchanged', 'wrong-module', 'redirect-after-ready'])(
    'does not accept a detail navigation for %s',
    async (variant) => {
      const page = await browser.newPage();
      const current = `${url}detail-fixture#/object-detail/object-detail-1792134966120-9x684516?from=%2Forders`;
      await page.goto(current);
      const signal = new AbortController().signal;
      const connection = await connectScenarioPage(
        { underlyingPage: page },
        signal,
      );
      try {
        const effect = {
          beforeUrl: `${url}detail-fixture#/orders`,
          afterUrl: `${url}detail-fixture#/object-detail/object-detail-1792131578759-56ydmi2o?from=%2Forders`,
          observationStepId: 'detail',
          runtime: {
            beforeUrl:
              variant === 'unchanged'
                ? current
                : `${url}detail-fixture#/orders`,
          },
        };
        if (variant === 'wrong-module') {
          await page.evaluate(() => {
            location.hash = location.hash.replace('%2Forders', '%2Ftasks');
          });
          await connection.page.waitForURL(
            current.replace('%2Forders', '%2Ftasks'),
          );
        }
        const waitReady =
          variant === 'redirect-after-ready'
            ? async () => {
                await page.evaluate(() => {
                  location.hash = '/workbench';
                });
                await connection.page.waitForURL(
                  `${url}detail-fixture#/workbench`,
                );
              }
            : undefined;
        await expect(
          waitForScenarioNavigation(
            connection.page,
            effect,
            signal,
            waitReady,
            150,
          ),
        ).rejects.toThrow(/未切换|离开/);
      } finally {
        await connection.close();
        await page.close();
      }
    },
  );

  it.each(['unbound', 'wrong-module-binding'])(
    'blocks an invalid temporary start (%s) without navigating to a stale session',
    async (variant) => {
      const page = await browser.newPage();
      await page.goto(`${url}detail-fixture#/orders`);
      const signal = new AbortController().signal;
      const connection = await connectScenarioPage(
        { underlyingPage: page },
        signal,
      );
      try {
        const before = page.url();
        const recorded = `${url}detail-fixture#/object-detail/object-detail-1792131578759-56ydmi2o?from=%2Forders`;
        const bindings = new Map();
        if (variant === 'wrong-module-binding')
          bindings.set(
            scenarioRoute(recorded),
            recorded
              .replace('1792131578759-56ydmi2o', '1792134966120-9x684516')
              .replace('from=%2Forders', 'from=%2Ftasks'),
          );
        const start = step('navigation', {
          actionType: 'InitialNavigation',
          url: recorded,
        });
        await expect(
          executeScenarioNative(connection.page, start, signal, 0, {
            navigationBindings: bindings,
          }),
        ).rejects.toThrow('临时详情页');
        const runner = new ScenarioRunner({
          scenarioId: 'missing-prerequisite',
          scripts: [
            {
              id: 'detail',
              name: '详情操作',
              startMode: 'automatic',
              steps: [start],
            },
          ],
        });
        const recover = vi.fn(async () => true);
        await runner.run(
          (s, signal, index) =>
            executeScenarioNative(connection.page, s, signal, index, {
              navigationBindings: bindings,
            }),
          { recover },
        );
        expect(runner.state.status).toBe('blocked');
        expect(recover).not.toHaveBeenCalled();
        expect(page.url()).toBe(before);
      } finally {
        await connection.close();
        await page.close();
      }
    },
  );

  it('preserves the actual starting detail when target lookup fails before recovery', async () => {
    const page = await browser.newPage();
    const current = `${url}detail-fixture#/object-detail/object-detail-1792134966120-9x684516?from=%2Forders`;
    await page.goto(current);
    const abort = new AbortController();
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      abort.signal,
    );
    const effect = {
      beforeUrl: `${url}detail-fixture#/orders`,
      afterUrl: current.replace(
        '1792134966120-9x684516',
        '1792131578759-56ydmi2o',
      ),
      observationStepId: 'detail',
    };
    const timer = setTimeout(
      () => abort.abort(new Error('Stopped missing-target check')),
      350,
    );
    try {
      await expect(
        executeScenarioNative(
          connection.page,
          step('click', {
            nativeTarget: { locator: { selector: '#missing-order' } },
          }),
          abort.signal,
          0,
          { navigationEffect: effect },
        ),
      ).rejects.toThrow();
      expect(effect.runtime.beforeUrl).toBe(current);
      expect(scenarioNavigationMatches(effect, current)).toBe(false);
    } finally {
      clearTimeout(timer);
      await connection.close();
      await page.close();
    }
  });

  it.each(['link', 'nested'])(
    'replays regenerated virtual-table task selections with %s codes using native Playwright and exported locators',
    async (codeMarkup) => {
      const table = (options = {}) =>
        productionTaskTable({
          codeMarkup,
          extraCheckboxes: codeMarkup === 'nested',
          ...options,
        });
      const page = await browser.newPage();
      await page.goto(url);
      await page.setContent(table());
      const signal = new AbortController().signal;
      const connection = await connectScenarioPage(
        { underlyingPage: page },
        signal,
      );
      try {
        const steps = [];
        for (const operation of [10, 20, 30, 40]) {
          const point = await page.$eval(
            `[data-operation="${operation}"]`,
            (input) => {
              const rect = input.getBoundingClientRect();
              return {
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
              };
            },
          );
          const nativeTarget = await page.evaluate(
            buildRecorderNativeCaptureScript({ actionType: 'Tap', ...point }),
          );
          steps.push(
            step('click', { actionType: 'Tap', nativeTarget }, steps.length),
          );
        }
        for (const generation of [277, 278]) {
          await page.setContent(
            table({
              generation,
              operations: [40, 10, 30, 20],
              status: '已派工',
            }),
          );
          for (const operation of steps)
            await executeScenarioNative(connection.page, operation, signal, 0);
          expect(
            await page.$$eval('input:checked', (inputs) =>
              inputs
                .map((input) => Number(input.dataset.operation))
                .sort((a, b) => a - b),
            ),
          ).toEqual([10, 20, 30, 40]);
        }
        await page.setContent(
          table({ generation: 279, operations: [30, 20, 40, 10] }),
        );
        for (const operation of steps) {
          const expression = recorderNativeLocatorExpression(
            operation.event.nativeTarget.locator,
          );
          expect(operation.code).toContain(expression);
          const target = new Function('page', `return ${expression}`)(
            connection.page,
          );
          expect(await target.count()).toBe(1);
          await target.click();
        }
        expect(
          await page.$$eval('input:checked', (inputs) =>
            inputs
              .map((input) => Number(input.dataset.operation))
              .sort((a, b) => a - b),
          ),
        ).toEqual([10, 20, 30, 40]);
      } finally {
        await connection.close();
        await page.close();
      }
    },
    30000,
  );

  it('does not click either task when a regenerated operation has two matching business rows', async () => {
    const page = await browser.newPage();
    await page.goto(url);
    await page.setContent(productionTaskTable());
    const point = await page.$eval('[data-operation="20"]', (input) => {
      const rect = input.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    const nativeTarget = await page.evaluate(
      buildRecorderNativeCaptureScript({ actionType: 'Tap', ...point }),
    );
    await page.setContent(
      productionTaskTable({ generation: 277 }) +
        productionTaskTable({ generation: 278 }),
    );
    const abort = new AbortController();
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      abort.signal,
    );
    let timer;
    try {
      const expression = recorderNativeLocatorExpression(nativeTarget.locator);
      expect(
        await new Function('page', `return ${expression}`)(
          connection.page,
        ).count(),
      ).toBe(2);
      const pending = executeScenarioNative(
        connection.page,
        step('click', { actionType: 'Tap', nativeTarget }),
        abort.signal,
        0,
      );
      timer = setTimeout(
        () => abort.abort(new Error('ambiguous target test stopped')),
        250,
      );
      await expect(pending).rejects.toThrow();
      expect(
        await page.$$eval('input:checked', (inputs) => inputs.length),
      ).toBe(0);
    } finally {
      clearTimeout(timer);
      await connection.close();
      await page.close();
    }
  }, 30000);

  it('replays menu expansion followed by an early route observation and menu-item click', async () => {
    const page = await browser.newPage();
    await page.goto(`${url}spa#/workbench`);
    await page.evaluate(() => {
      document.querySelector('#delayed').hidden = true;
    });
    const signal = new AbortController().signal;
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      signal,
    );
    try {
      const beforeUrl = page.url();
      const afterUrl = `${url}spa#/orders?run=recorded`;
      const steps = [
        step(
          'click',
          {
            actionType: 'Tap',
            url: beforeUrl,
            nativeTarget: { locator: { selector: '#expand' } },
          },
          0,
        ),
        step(
          'navigation',
          {
            actionType: 'Navigate',
            url: afterUrl,
            rawPayload: {
              implicitNavigationState: true,
              triggerActionType: 'SessionNavigation',
              beforeUrl,
              afterUrl,
            },
          },
          1,
        ),
        step(
          'click',
          {
            actionType: 'Tap',
            url: beforeUrl,
            nativeTarget: { locator: { selector: '#delayed' } },
          },
          2,
        ),
      ];
      for (let index = 0; index < steps.length; index++) {
        await executeScenarioNative(connection.page, steps[index], signal, 0, {
          navigationEffect: scenarioNavigationEffect(steps, index),
          waitReady: connection.waitForAssertionReady,
        });
        if (index < 2) expect(page.url()).toBe(beforeUrl);
      }
      expect(await connection.page.locator('main').textContent()).toBe(
        'Orders ready',
      );
    } finally {
      await connection.close();
      await page.close();
    }
  });

  it('ignores old IME notifications while retaining committed input and real key failures', async () => {
    const page = await browser.newPage();
    await page.goto(url);
    const signal = new AbortController().signal;
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      signal,
    );
    try {
      const nativeTarget = { editable: true, locator: { selector: '#value' } };
      const result = await executeScenarioNative(
        connection.page,
        step('keydown', {
          source: 'studio-preview',
          actionType: 'KeyboardPress',
          value: 'Process',
          nativeTarget,
        }),
        signal,
        0,
      );
      expect(result.detail).toContain('input-method');
      await executeScenarioNative(
        connection.page,
        step('input', {
          source: 'studio-preview',
          actionType: 'Input',
          value: '生产订单',
          nativeTarget,
        }),
        signal,
        0,
      );
      expect(await connection.page.locator('#value').inputValue()).toBe(
        '生产订单',
      );
      await expect(
        executeScenarioNative(
          connection.page,
          step('keydown', {
            source: 'studio-preview',
            actionType: 'KeyboardPress',
            value: 'InvalidRealKey',
            nativeTarget,
          }),
          signal,
          0,
        ),
      ).rejects.toThrow('Unknown key');
    } finally {
      await connection.close();
      await page.close();
    }
  });

  it('checks an early recorded SPA navigation after its menu action and waits for rendered readiness', async () => {
    const page = await browser.newPage();
    await page.goto(`${url}spa#/workbench`);
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      new AbortController().signal,
    );
    try {
      const beforeUrl = `${url}spa#/workbench`;
      const afterUrl = `${url}spa#/orders?run=recorded`;
      const steps = [
        step('navigation', {
          actionType: 'Navigate',
          url: afterUrl,
          rawPayload: {
            implicitNavigationState: true,
            triggerActionType: 'SessionNavigation',
            beforeUrl,
            afterUrl,
          },
        }),
        step(
          'click',
          {
            actionType: 'Tap',
            url: beforeUrl,
            nativeTarget: { locator: { selector: '#delayed' } },
          },
          1,
        ),
      ];
      const runner = new ScenarioRunner(
        validateScenarioRun({
          scenarioId: 'scene',
          scripts: [{ id: 'a', name: 'A', startMode: 'automatic', steps }],
        }),
      );
      const done = runner.run((s, signal, index) =>
        executeScenarioNative(connection.page, s, signal, index, {
          navigationEffect: scenarioNavigationEffect(
            steps,
            runner.state.stepIndex,
          ),
          waitReady: connection.waitForAssertionReady,
        }),
      );
      await expect.poll(() => runner.state.stepIndex).toBe(1);
      expect(runner.state.scripts[0].steps[1].status).toBe('running');
      await done;
      expect(runner.state.status).toBe('completed');
      expect(await connection.page.locator('main').textContent()).toBe(
        'Orders ready',
      );
      expect(page.url()).toBe(`${url}spa#/orders?run=current`);
      expect(runner.state.scripts[0].steps[0].detail).toContain(
        'recording context',
      );
      expect(runner.state.scripts[0].steps[1].detail).toContain(
        'Route transition verified',
      );
    } finally {
      await connection.close();
      await page.close();
    }
  });

  it('fails an ineffective menu click on the action itself without replaying it or navigating to the historical URL', async () => {
    const page = await browser.newPage();
    await page.goto(`${url}spa#/workbench`);
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      new AbortController().signal,
    );
    try {
      const beforeUrl = `${url}spa#/workbench`;
      const effect = {
        beforeUrl,
        afterUrl: `${url}spa#/orders`,
        observationStepId: 'observed',
      };
      const click = step('click', {
        actionType: 'Tap',
        url: beforeUrl,
        nativeTarget: { locator: { selector: '#ineffective' } },
      });
      await page.evaluate(() => {
        window.clicks = 0;
        document.querySelector('#ineffective').onclick = () => window.clicks++;
      });
      await expect(
        executeScenarioNative(
          connection.page,
          click,
          new AbortController().signal,
          0,
          { navigationEffect: effect },
        ),
      ).rejects.toThrow('未切换');
      expect(page.url()).toBe(beforeUrl);
      expect(await page.evaluate(() => window.clicks)).toBe(1);
      // A recovery Agent's positive claim cannot bypass the same route check.
      await expect(
        waitForScenarioNavigation(
          connection.page,
          effect,
          new AbortController().signal,
          undefined,
          150,
        ),
      ).rejects.toThrow('未切换');
      expect(await page.evaluate(() => window.clicks)).toBe(1);
    } finally {
      await connection.close();
      await page.close();
    }
  }, 20000);

  it('cancels a pending route check and preserves the current document', async () => {
    const page = await browser.newPage();
    await page.goto(`${url}spa#/workbench`);
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      new AbortController().signal,
    );
    try {
      const stop = new AbortController();
      const pending = waitForScenarioNavigation(
        connection.page,
        {
          beforeUrl: page.url(),
          afterUrl: `${url}spa#/orders`,
          observationStepId: 'observed',
        },
        stop.signal,
      );
      stop.abort(new Error('Stopped by test'));
      await expect(pending).rejects.toThrow();
      expect(page.url()).toBe(`${url}spa#/workbench`);
      expect(page.isClosed()).toBe(false);
    } finally {
      await connection.close();
      await page.close();
    }
  });

  it.each([0, 1])(
    'opens a different starting page for script index %i, retaining browser session',
    async (scriptIndex) => {
      const page = await browser.newPage();
      await page.goto(url);
      await page.evaluate(() => sessionStorage.setItem('session', 'retained'));
      const connection = await connectScenarioPage(
        { underlyingPage: page },
        new AbortController().signal,
      );
      try {
        const navigation = step('navigation', {
          actionType: 'InitialNavigation',
          url: `${url}orders`,
        });
        await executeScenarioNative(
          connection.page,
          navigation,
          new AbortController().signal,
          scriptIndex,
        );
        expect(page.url()).toBe(`${url}orders`);
        expect(
          await page.evaluate(() => sessionStorage.getItem('session')),
        ).toBe('retained');
        await connection.page.locator('#value').fill('unsaved');
        await executeScenarioNative(
          connection.page,
          navigation,
          new AbortController().signal,
          scriptIndex,
        );
        expect(await connection.page.locator('#value').inputValue()).toBe(
          'unsaved',
        );
      } finally {
        await connection.close();
        await page.close();
      }
    },
  );
  it('replays old and new navigation snapshots after a redirect without asserting or revisiting historical URLs', async () => {
    const page = await browser.newPage();
    await page.goto(`${url}redirect`);
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      new AbortController().signal,
    );
    try {
      await connection.page.locator('#value').fill('retained');
      for (const modern of [false, true]) {
        const steps = [
          step('navigation', {
            actionType: 'NavigationChanged',
            url: `${url}redirect`,
          }),
          step(
            'navigation',
            {
              actionType: 'Navigate',
              url: `${url}orders?run=recorded`,
              rawPayload: { implicitNavigationState: true },
            },
            1,
          ),
          step(
            'click',
            {
              actionType: 'Click',
              nativeTarget: { locator: { selector: 'button', text: 'Save' } },
            },
            2,
          ),
        ];
        if (modern) {
          for (const s of steps)
            s.code = compileRecorderNativePlaywright({
              events: [s.event],
              format: 'operation',
              platformId: 'web',
              stepOffset: s.operationIndex,
              sensitiveInputs: 'recorded',
              navigationMode: 'scenario',
            });
        }
        const runner = new ScenarioRunner(
          validateScenarioRun({
            scenarioId: 'scene',
            scripts: [{ id: 'a', name: 'A', startMode: 'automatic', steps }],
          }),
        );
        await runner.run((s, signal, index) =>
          executeScenarioNative(connection.page, s, signal, index),
        );
        expect(runner.state.error).toBeUndefined();
        expect(runner.state.status).toBe('completed');
        expect(page.url()).toBe(`${url}orders?run=current`);
        expect(await connection.page.locator('#result').textContent()).toBe(
          'retained',
        );
      }
    } finally {
      await connection.close();
      await page.close();
    }
  });
  it('still stops on a missing target or a failed explicit checkpoint after an observed navigation', async () => {
    const page = await browser.newPage();
    await page.goto(`${url}wrong-page`);
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      new AbortController().signal,
    );
    try {
      for (const failure of [
        step(
          'click',
          {
            actionType: 'Click',
            nativeTarget: { locator: { selector: '#orders-only' } },
          },
          1,
        ),
        {
          id: 'assertion',
          type: 'agent-assertion',
          description: 'Orders page is visible',
          instruction: 'Orders page is visible',
        },
      ]) {
        const runner = new ScenarioRunner(
          validateScenarioRun({
            scenarioId: 'scene',
            scripts: [
              {
                id: 'a',
                name: 'A',
                startMode: 'automatic',
                steps: [
                  step('navigation', {
                    actionType: 'NavigationChanged',
                    url: `${url}orders`,
                  }),
                  failure,
                  step(
                    'input',
                    {
                      value: 'must not execute',
                      nativeTarget: {
                        editable: true,
                        locator: { selector: '#value' },
                      },
                    },
                    2,
                  ),
                ],
              },
            ],
          }),
        );
        await runner.run((s, signal, index) =>
          s.type === 'agent-assertion'
            ? executeScenarioAgentStep(s, async () => ({
                pass: false,
                thought: 'Wrong page',
              }))
            : executeScenarioNative(connection.page, s, signal, index),
        );
        expect(runner.state.status).toBe('failed');
        expect(runner.state.scripts[0].completedSteps).toBe(1);
        expect(runner.state.error).toBe(
          failure.type === 'agent-assertion'
            ? 'Wrong page'
            : 'The recorded target is missing or is not unique.',
        );
        expect(await connection.page.locator('#value').inputValue()).toBe('');
      }
    } finally {
      await connection.close();
      await page.close();
    }
  }, 30000);
  it('replays existing and new password steps using the saved value without environment configuration', async () => {
    const page = await browser.newPage();
    await page.goto(url);
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      new AbortController().signal,
    );
    try {
      const input = step(
        'input',
        {
          value: 'recorded-test-value',
          nativeTarget: {
            editable: true,
            sensitive: true,
            locator: { selector: '#value' },
          },
        },
        6,
      );
      const plan = {
        scenarioId: 'scene',
        scripts: [
          {
            id: 'login',
            name: 'Login',
            startMode: 'automatic',
            steps: [input],
          },
        ],
      };
      expect(input.code).toContain('MIDSCENE_INPUT_007');
      validateScenarioRun(plan);
      await executeScenarioNative(
        connection.page,
        input,
        new AbortController().signal,
        0,
      );
      expect(await page.$eval('#value', (el) => el.value)).toBe(
        'recorded-test-value',
      );
      input.code = compileRecorderNativePlaywright({
        events: [input.event],
        format: 'operation',
        platformId: 'web',
        stepOffset: 6,
        sensitiveInputs: 'recorded',
      });
      expect(input.code).toContain('fill("recorded-test-value")');
      validateScenarioRun(plan);
      await executeScenarioNative(
        connection.page,
        input,
        new AbortController().signal,
        0,
      );
      expect(await page.$eval('#value', (el) => el.value)).toBe(
        'recorded-test-value',
      );
    } finally {
      await connection.close();
      await page.close();
    }
  });
  it('targets the exact tab, preserves state across scripts and disconnects without closing the browser', async () => {
    const page = await browser.newPage();
    const other = await browser.newPage();
    await Promise.all([page.goto(url), other.goto(url)]);
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      new AbortController().signal,
    );
    try {
      const input = {
        scenarioId: 'scene',
        scripts: [
          {
            id: 'a',
            name: 'Enter',
            startMode: 'automatic',
            steps: [
              step('navigation', { actionType: 'InitialNavigation', url }),
              step(
                'input',
                {
                  value: 'AB',
                  nativeTarget: {
                    editable: true,
                    locator: { selector: '#value' },
                  },
                },
                1,
              ),
            ],
          },
          {
            id: 'b',
            name: 'Complete',
            startMode: 'manual',
            steps: [
              step('navigation', { actionType: 'InitialNavigation', url }),
              step(
                'input',
                {
                  value: 'C',
                  rawPayload: { mode: 'typeOnly' },
                  nativeTarget: {
                    editable: true,
                    locator: { selector: '#value' },
                    selection: { start: 2, end: 2, valueLength: 2 },
                  },
                },
                1,
              ),
              step(
                'click',
                {
                  actionType: 'Click',
                  nativeTarget: {
                    locator: {
                      selector: 'button',
                      text: 'Save',
                      visible: true,
                    },
                  },
                },
                2,
              ),
              step(
                'scroll',
                {
                  rawPayload: {
                    scrollType: 'singleAction',
                    direction: 'down',
                    distance: 200,
                  },
                  nativeTarget: { locator: { selector: '#scroll' } },
                },
                3,
              ),
            ],
          },
        ],
      };
      const runner = new ScenarioRunner(validateScenarioRun(input));
      const done = runner.run((s, signal, index) =>
        executeScenarioNative(connection.page, s, signal, index),
      );
      await expect.poll(() => runner.state.status).toBe('waiting');
      expect(await page.$eval('#value', (el) => el.value)).toBe('AB');
      runner.next(1);
      await done;
      expect(runner.state.error).toBeUndefined();
      expect(runner.state.status).toBe('completed');
      expect(await page.$eval('#result', (el) => el.textContent)).toBe('ABC');
      expect(await page.$eval('#scroll', (el) => el.scrollTop)).toBe(200);
      expect(await other.$eval('#value', (el) => el.value)).toBe('');
      const modified = structuredClone(input);
      modified.scripts[0].steps[1].code += '\nmalicious();';
      expect(() => validateScenarioRun(modified)).toThrow();
    } finally {
      await connection.close();
    }
    expect(browser.connected).toBe(true);
    expect(
      await page.evaluate(() => document.querySelector('#result').textContent),
    ).toBe('ABC');
    await page.close();
    await other.close();
  }, 30000);
  it('cancels a waiting native action while retaining the Puppeteer session', async () => {
    const page = await browser.newPage();
    await page.goto(url);
    const abort = new AbortController();
    const connection = await connectScenarioPage(
      { underlyingPage: page },
      abort.signal,
    );
    const pending = executeScenarioNative(
      connection.page,
      step('click', {
        actionType: 'Click',
        nativeTarget: { locator: { selector: '#missing' } },
      }),
      abort.signal,
      0,
    );
    abort.abort(new Error('Stopped by test'));
    await expect(pending).rejects.toThrow();
    await connection.close().catch(() => {});
    expect(await page.title()).toBe('');
    expect(page.isClosed()).toBe(false);
    await page.close();
  }, 30000);
});
