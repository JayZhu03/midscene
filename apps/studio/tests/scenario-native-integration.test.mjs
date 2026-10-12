import { createServer } from 'node:http';
import { compileRecorderNativePlaywright } from '@midscene/shared/recorder-native';
import puppeteer from 'puppeteer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectScenarioPage,
  executeScenarioNative,
} from '../../../packages/playground/src/scenario-native';
import {
  ScenarioRunner,
  executeScenarioAgentStep,
  validateScenarioRun,
} from '../../../packages/playground/src/scenario-runner';

let browser;
let server;
let url;
beforeAll(async () => {
  server = createServer((req, res) => {
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
