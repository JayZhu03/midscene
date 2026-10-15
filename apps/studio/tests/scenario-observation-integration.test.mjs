import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PuppeteerAgent } from '@midscene/web/puppeteer';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  ScenarioEvidence,
  endsNativeEvidenceBlock,
} from '../../../packages/playground/src/scenario-evidence';
import {
  connectScenarioPage,
  executeScenarioNative,
} from '../../../packages/playground/src/scenario-native';
import { ScenarioObservation } from '../../../packages/playground/src/scenario-observation';
import { renderScenarioHtmlConclusion } from '../../../packages/playground/src/scenario-report-html';
import {
  readScenarioHtml,
  saveScenarioReport,
} from '../../../packages/playground/src/scenario-report-storage';

let browser;
let directory;
async function expectPlayerFillsCanvas(frame) {
  await frame.waitForFunction(
    () => {
      const canvas = document.querySelector('.canvas-container');
      const image = Array.from(
        document.querySelectorAll('.player-container img'),
      ).find((img) => !img.style.position && img.complete && img.naturalWidth);
      if (!canvas || !image) return false;
      const area = canvas.getBoundingClientRect();
      const picture = image.getBoundingClientRect();
      const ratio = image.naturalWidth / image.naturalHeight;
      const width = Math.min(area.width, area.height * ratio);
      return (
        width > 0 &&
        Math.abs(picture.width - width) < 2 &&
        Math.abs(picture.height - width / ratio) < 2
      );
    },
    { timeout: 5000 },
  );
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-observation-'));
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => {
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('captures a disappearing toast before a native click, retains current evidence and opens the official HTML viewer offline', async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  await page.setContent(
    `<style>body{margin:0;background:white}#toast{position:absolute;left:0;top:0;width:300px;height:100px;background:rgb(255,0,0);color:white;font-size:28px}button{position:absolute;top:150px}</style><div id="toast" hidden>Saved successfully</div><button onclick="document.getElementById('toast').hidden=false;setTimeout(()=>document.getElementById('toast').hidden=true,700)">Save</button>`,
  );
  const agent = new PuppeteerAgent(page, {
    autoPrintReportMsg: false,
    reportFileName: `observation-test-${Date.now()}`,
    modelConfig: {
      MIDSCENE_MODEL_NAME: 'qwen3-vl-plus',
      MIDSCENE_MODEL_FAMILY: 'qwen3-vl',
      MIDSCENE_MODEL_API_KEY: 'test',
      MIDSCENE_MODEL_BASE_URL: 'http://127.0.0.1:1/v1',
    },
  });
  const run = {
    id: 'transient-test',
    scenarioId: 's',
    scenarioName: '瞬时提示验证',
    status: 'completed',
    scriptIndex: 0,
    stepIndex: 0,
    scripts: [],
  };
  const evidence = new ScenarioEvidence(directory, run);
  await evidence.attach(agent);
  const signal = new AbortController().signal;
  const operation = {
    id: 'save',
    type: 'playwright-operation',
    description: 'Save',
  };
  run.scripts = [
    {
      id: 's',
      name: '保存流程',
      status: 'passed',
      completedSteps: 1,
      totalSteps: 1,
      steps: [{ ...operation, status: 'passed' }],
    },
  ];
  evidence.setStep(operation, 0, 0);
  const session = new ScenarioObservation(
    () => agent,
    () => evidence.flush(),
    1000,
  );
  const original = agent.startObserving.bind(agent);
  let captured = [];
  let finalImage;
  // Use the real SDK sampler, storage, page and official renderer. Only the
  // model judgment is substituted here; live-model coverage is a separate test.
  agent.startObserving = async (options) => {
    const observer = await original(options);
    const stop = observer.stop.bind(observer);
    observer.stop = async () => {
      const observation = await stop();
      observation.aiAssert = async (prompt) => {
        const record = await observation.exportRecord();
        captured = await Promise.all(
          record.frames.map(async (frame) => ({
            ...frame,
            bytes: await readFile(frame.path),
          })),
        );
        finalImage = prompt.images[0].url;
        await agent.recordToReport('Observed frames', {
          screenshots: captured.map((f) => ({
            base64: `data:${f.mimeType};base64,${f.bytes.toString('base64')}`,
            description: `Observed at ${f.capturedAt}`,
          })),
        });
        return {
          pass: true,
          thought: 'A transient toast appeared; current page has no toast.',
        };
      };
      return observation;
    };
    return observer;
  };
  try {
    await session.begin(operation, signal);
    await evidence.record(agent, operation, '操作前');
    await page.click('button');
    session.operationCompleted();
    await evidence.record(agent, operation, '操作后');
    await session.assert(
      {
        id: 'assert',
        type: 'agent-assertion',
        description: '出现成功提示',
        instruction: '出现成功提示',
      },
      signal,
    );
    const pixel = async (bytes) =>
      Array.from(
        await sharp(bytes)
          .extract({ left: 30, top: 80, width: 1, height: 1 })
          .removeAlpha()
          .raw()
          .toBuffer(),
      );
    const colors = await Promise.all(captured.map((f) => pixel(f.bytes)));
    expect(colors.some(([r, g, b]) => r > 200 && g < 70 && b < 70)).toBe(true);
    expect(
      await pixel(Buffer.from(finalImage.split(',')[1], 'base64')),
    ).toEqual([255, 255, 255]);
    await session.clear();
    await evidence.finish();
    run.summary = {
      status: 'completed',
      format: 'html',
      text: renderScenarioHtmlConclusion(run),
    };
    await saveScenarioReport(directory, run);
    const html = await readScenarioHtml(directory, run.id);
    expect(html).toContain('midscene_web_dump');
    const reportPage = await browser.newPage();
    const errors = [];
    reportPage.on('pageerror', (error) => errors.push(error.message));
    await reportPage.goto(
      `file:///${join(directory, `${run.id}.html`).replaceAll('\\', '/')}`,
    );
    // Reproduce Studio's outer sandbox as well as the report's inner iframe.
    await reportPage.evaluate((html) => {
      const outer = document.createElement('iframe');
      outer.setAttribute('sandbox', 'allow-scripts');
      outer.setAttribute('allow', 'fullscreen *');
      outer.allowFullscreen = true;
      outer.style.cssText = 'border:0;width:100vw;height:100vh';
      outer.srcdoc = html;
      document.body.replaceChildren(outer);
      document.body.style.margin = '0';
    }, html);
    const outer = await reportPage.waitForSelector('body > iframe');
    const reportRoot = await outer.contentFrame();
    await reportRoot.waitForSelector('label[for="evidence"]');
    await reportRoot.click('label[for="evidence"]');
    const iframe = await reportRoot.waitForSelector('iframe');
    const frame = await iframe.contentFrame();
    await frame
      .waitForFunction(
        () =>
          document.body.innerText.includes('Save') ||
          document.body.innerText.includes('Observed'),
        { timeout: 8000 },
      )
      .catch(async () => {
        throw new Error(
          JSON.stringify({
            errors,
            body: (await frame.evaluate(() => document.body.innerText)).slice(
              0,
              1500,
            ),
          }),
        );
      });
    expect(
      await frame
        .locator('body')
        .map((el) => el.innerText)
        .wait(),
    ).toContain('Save');
    await frame
      .waitForFunction(
        () =>
          Array.from(document.querySelectorAll('.player-container img')).some(
            (img) => img.complete && img.naturalWidth > 0,
          ),
        { timeout: 5000 },
      )
      .catch(async () => {
        throw new Error(
          JSON.stringify(
            await frame.evaluate(() => ({
              body: document.body.innerText.slice(0, 4000),
              players: document.querySelectorAll('.player-container').length,
              images: Array.from(document.images).map((img) => ({
                complete: img.complete,
                width: img.naturalWidth,
                className: img.className,
              })),
            })),
          ),
        );
      });
    if (await frame.$('.player-container [aria-label="caret-right"]'))
      await frame.click('.player-container .status-icon');
    await frame.waitForSelector('.player-container [aria-label="pause"]');
    expect(await frame.evaluate(() => document.body.innerText)).toContain(
      '执行步骤',
    );
    // The process starts in a hidden tab; it must size correctly when revealed
    // and after entering fullscreen through the sandboxed report iframe.
    await frame.evaluate(() =>
      document.querySelector('.player-container .status-icon')?.click(),
    );
    await expectPlayerFillsCanvas(frame);
    await reportPage.setViewport({ width: 1440, height: 900 });
    await expectPlayerFillsCanvas(frame);
    await frame.hover('.canvas-container');
    await frame.click('button[aria-label="放大观看"]');
    await frame.waitForFunction(() => Boolean(document.fullscreenElement));
    await expectPlayerFillsCanvas(frame);
    expect(
      await frame.evaluate(
        () =>
          document.querySelector('.canvas-container').getBoundingClientRect()
            .width,
      ),
    ).toBe(1440);
    await frame.hover('.canvas-container');
    await frame.click('button[aria-label="退出全屏"]');
    await frame.waitForFunction(() => !document.fullscreenElement);
    await expectPlayerFillsCanvas(frame);
    await frame.hover('.player-custom-controls .ant-dropdown-trigger');
    await frame.waitForSelector('.player-settings-dropdown');
    expect(await frame.$('.player-export-label')).toBeNull();
    expect(await frame.$('.open-in-playground-trigger')).toBeNull();
    await reportRoot.click('label[for="conclusion"]');
    await reportRoot.click('#overview details summary');
    const taskId = run.evidenceLinks.at(-1).taskId;
    await reportRoot.click(`[data-task-id="${taskId}"]`);
    await frame
      .waitForFunction(
        (id) =>
          document.getElementById(`task-${id}`)?.className.includes('selected'),
        { timeout: 5000 },
        taskId,
      )
      .catch(async () => {
        throw new Error(
          JSON.stringify({
            errors,
            taskId,
            selected: await frame.evaluate(() =>
              Array.from(document.querySelectorAll('.selected')).map(
                (el) => el.id,
              ),
            ),
            body: await frame.evaluate(() => ({
              text: document.body.innerText.slice(0, 2000),
              url: location.href,
              count: document.querySelectorAll('.task-row').length,
              hash: location.hash,
            })),
          }),
        );
      });
    expect(await frame.evaluate(() => document.body.innerText)).toContain(
      '保存流程',
    );
    expect(errors).toEqual([]);
    await reportPage.close();
  } finally {
    await session.clear();
    await evidence.finish();
    await agent.destroy();
    await page.close();
  }
}, 60000);

it('keeps one final input frame across case switches and selection, separate fields and actual click geometry', async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });
  await page.setContent(
    `<style>body{margin:0;background:white}input,button{display:block;margin:20px;width:200px;height:35px}</style><input id="name" oninput="document.body.style.background=this.value==='Super'?'rgb(0,255,0)':'white'"><input id="other"><button id="submit" onpointerdown="window.lastPointer=[event.clientX,event.clientY]" onclick="document.body.style.background='rgb(0,0,255)';document.querySelector('#name').remove()">Save</button>`,
  );
  const agent = new PuppeteerAgent(page, {
    autoPrintReportMsg: false,
    reportFileName: 'native-evidence-test',
    modelConfig: {
      MIDSCENE_MODEL_NAME: 'qwen3-vl-plus',
      MIDSCENE_MODEL_FAMILY: 'qwen3-vl',
      MIDSCENE_MODEL_API_KEY: 'test',
      MIDSCENE_MODEL_BASE_URL: 'http://127.0.0.1:1/v1',
    },
  });
  const native = (id, type, selector, value) => ({
    id,
    type: 'playwright-operation',
    description: id,
    event: {
      hashId: id,
      type,
      value,
      timestamp: Date.now(),
      pageInfo: { width: 800, height: 600 },
      source: 'studio-preview',
      nativeTarget: { locator: { selector }, editable: type !== 'click' },
    },
  });
  const steps = [
    native('切换大写', 'keydown', '#name', 'CapsLock'),
    native('填写 S', 'input', '#name', 'S'),
    native('选中文字', 'keydown', '#name', 'Shift+ArrowLeft'),
    native('填写 Su', 'input', '#name', 'Su'),
    native('选中全部', 'keydown', '#name', 'Control+A'),
    ...['Sup', 'Supe', 'Super'].map((value) =>
      native(`填写 ${value}`, 'input', '#name', value),
    ),
    native('切换小写', 'keydown', '#name', 'CapsLock'),
    native('输入法通知', 'keydown', '#name', 'Process'),
  ];
  steps.push(
    native('填写第二个字段', 'input', '#other', 'second'),
    native('提交', 'click', '#submit'),
  );
  const run = {
    id: 'native-evidence',
    scenarioId: 's',
    status: 'completed',
    scriptIndex: 0,
    stepIndex: 0,
    scripts: [{ id: 's', name: '表单', status: 'passed', steps }],
  };
  const evidence = new ScenarioEvidence(directory, run);
  const signal = new AbortController().signal;
  const connection = await connectScenarioPage(
    { underlyingPage: page },
    signal,
  );
  let screenshots = 0;
  const capture = connection.page.screenshot.bind(connection.page);
  connection.page.screenshot = (...args) => {
    screenshots++;
    return capture(...args);
  };
  let reportPage;
  try {
    await evidence.attach(agent);
    for (let i = 0; i < steps.length; i++) {
      evidence.setStep(steps[i], 0, i);
      await executeScenarioNative(connection.page, steps[i], signal, 0, {
        beforeAction: (target) =>
          evidence.beforeNativeAction(connection.page, target, steps[i]),
      });
      if (endsNativeEvidenceBlock(steps, i))
        await evidence.recordNativeOutcome(agent, steps[i], 0, connection.page);
    }
    await evidence.finish();
    expect(evidence.error).toBeUndefined();
    expect(run.evidenceLinks).toHaveLength(3);
    expect(run.evidenceLinks[0].stepIds).toEqual(
      steps.slice(0, -2).map((step) => step.id),
    );
    // Two final field frames plus the submit button's before/after evidence.
    expect(screenshots).toBe(4);
    expect(run.evidenceLinks[0].label).toContain('填写 Super');
    reportPage = await browser.newPage();
    const errors = [];
    reportPage.on('pageerror', (error) => errors.push(error.message));
    await reportPage.goto(
      `file:///${join(directory, 'native-evidence.evidence.html').replaceAll('\\', '/')}`,
    );
    const dump = await reportPage.evaluate(() =>
      JSON.parse(
        document.querySelector('script[type="midscene_web_dump"]').textContent,
      ),
    );
    const tasks = dump.executions.flatMap((execution) => execution.tasks);
    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => task.subType)).toEqual([
      'Input',
      'Input',
      'Tap',
    ]);
    expect(tasks[0].param.value).toBe('Super');
    expect(tasks[1].param.value).toBe('second');
    expect(tasks[2].param.locate.center).toEqual(
      await page.evaluate(() => window.lastPointer),
    );
    const shot = async (ref) => {
      const data = await reportPage.evaluate(
        (id) =>
          document
            .querySelector(`script[type="midscene-image"][data-id="${id}"]`)
            .textContent.trim(),
        ref.id,
      );
      const bytes = Buffer.from(data.split(',')[1], 'base64');
      const metadata = await sharp(bytes).metadata();
      expect(metadata.width).toBe(800);
      return Array.from(
        await sharp(bytes)
          .extract({ left: 700, top: 500, width: 1, height: 1 })
          .removeAlpha()
          .raw()
          .toBuffer(),
      );
    };
    const inputPixel = await shot(tasks[0].recorder[0].screenshot);
    expect(inputPixel[1]).toBeGreaterThan(245);
    expect(inputPixel[2]).toBeLessThan(10);
    const beforePixel = await shot(tasks[2].uiContext.screenshot);
    expect(beforePixel[1]).toBeGreaterThan(245);
    const afterPixel = await shot(tasks[2].recorder[0].screenshot);
    expect(afterPixel[2]).toBeGreaterThan(245);
    expect(afterPixel[1]).toBeLessThan(10);
    await reportPage.waitForSelector('.player-container img');
    await reportPage.click(`#task-${tasks[2].taskId}`);
    await reportPage.waitForSelector(`#task-${tasks[2].taskId}.selected`);
    await reportPage.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('.player-container img')).some(
          (img) =>
            img.style.filter.includes('drop-shadow') &&
            img.complete &&
            img.naturalWidth > 0,
        ),
      { timeout: 5000 },
    );
    expect(errors).toEqual([]);
  } finally {
    await evidence.finish();
    await connection.close();
    await agent.destroy();
    await reportPage?.close();
    await page.close();
  }
}, 60000);

it('aligns native result screenshots with delayed rendering and never captures the next action', async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  const agent = new PuppeteerAgent(page, {
    autoPrintReportMsg: false,
    reportFileName: 'delayed-evidence-test',
  });
  const signal = new AbortController().signal;
  const connection = await connectScenarioPage(
    { underlyingPage: page },
    signal,
  );
  const steps = ['open', 'next', 'busy'].map((id) => ({
    id,
    type: 'playwright-operation',
    description: id,
    event: {
      hashId: id,
      type: 'click',
      timestamp: Date.now(),
      source: 'studio-preview',
      pageInfo: { width: 800, height: 600 },
      nativeTarget: { locator: { selector: `#${id}` } },
    },
  }));
  const run = {
    id: 'delayed-evidence',
    scenarioId: 's',
    status: 'completed',
    scriptIndex: 0,
    stepIndex: 0,
    scripts: [{ id: 's', name: '异步页面', status: 'passed', steps }],
  };
  const evidence = new ScenarioEvidence(
    directory,
    run,
    undefined,
    connection.waitForEvidenceReady,
  );
  try {
    await connection.page.route('https://evidence.test/**', async (route) => {
      if (route.request().url().endsWith('/query')) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        await route.fulfill({ body: 'ready' });
      } else {
        await route.fulfill({
          contentType: 'text/html',
          body: `<style>body{margin:0;background:white}button{margin:20px}</style>
            <div id="loading" aria-busy="true" hidden>Loading</div>
            <button id="open" onclick="loading.hidden=false;fetch('/query').then(()=>{loading.hidden=true;document.body.style.background='rgb(0,255,0)';document.getElementById('next').hidden=false})">Open</button>
            <button id="next" hidden onclick="document.body.style.background='rgb(0,0,255)'">Next</button>
            <button id="busy" onclick="loading.hidden=false">Keep loading</button>`,
        });
      }
    });
    await connection.page.goto('https://evidence.test/');
    await evidence.attach(agent);
    for (const [index, step] of steps.entries()) {
      evidence.setStep(step, 0, index);
      await executeScenarioNative(connection.page, step, signal, 0, {
        beforeAction: (target) =>
          evidence.beforeNativeAction(connection.page, target, step),
      });
      await evidence.recordNativeOutcome(
        agent,
        step,
        0,
        connection.page,
        signal,
      );
    }
    await evidence.finish();
    expect(evidence.error).toBeUndefined();
    expect(run.evidenceLinks.map((link) => link.pageSettled)).toEqual([
      true,
      true,
      false,
    ]);
    const html = await readFile(
      join(directory, `${run.id}.evidence.html`),
      'utf8',
    );
    const tags = [...html.matchAll(/<script\b[^<>\r\n]{0,200}>/g)];
    const dumpTag = tags.findLast((match) =>
      match[0].includes('midscene_web_dump'),
    );
    const start = dumpTag.index + dumpTag[0].length;
    const dump = JSON.parse(
      html.slice(start, html.indexOf('</script>', start)),
    );
    const colors = [];
    for (const execution of dump.executions) {
      const reference = execution.tasks[0].recorder[0].screenshot;
      const tag = tags.find((match) =>
        match[0].includes(`data-id="${reference.id}"`),
      );
      const offset = tag.index + tag[0].length;
      const data = html.slice(offset, html.indexOf('</script>', offset)).trim();
      colors.push(
        Array.from(
          await sharp(Buffer.from(data.split(',')[1], 'base64'))
            .extract({ left: 700, top: 500, width: 1, height: 1 })
            .removeAlpha()
            .raw()
            .toBuffer(),
        ),
      );
    }
    expect(colors).toEqual([
      [0, 255, 0],
      [0, 0, 255],
      [0, 0, 255],
    ]);
    expect(run.evidenceLinks.map((link) => link.stepIds)).toEqual([
      ['open'],
      ['next'],
      ['busy'],
    ]);
  } finally {
    await evidence.finish();
    await connection.close();
    await agent.destroy();
    await page.close();
  }
}, 20000);

it('captures initial navigation after a page fade or an empty SPA has actually rendered', async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  const agent = new PuppeteerAgent(page, { autoPrintReportMsg: false });
  const signal = new AbortController().signal;
  const connection = await connectScenarioPage(
    { underlyingPage: page },
    signal,
  );
  const steps = ['fade', 'empty'].map((id) => ({
    id,
    type: 'playwright-operation',
    description: `Navigate to https://navigation.test/${id}`,
    event: {
      hashId: id,
      type: 'navigation',
      actionType: 'InitialNavigation',
      url: `https://navigation.test/${id}`,
      timestamp: Date.now(),
      source: 'studio-preview',
      pageInfo: { width: 800, height: 600 },
    },
  }));
  const run = {
    id: 'navigation-render',
    scenarioId: 's',
    status: 'completed',
    scriptIndex: 0,
    stepIndex: 0,
    scripts: [{ id: 's', name: '首次打开', status: 'passed', steps }],
  };
  const evidence = new ScenarioEvidence(
    directory,
    run,
    undefined,
    connection.waitForEvidenceReady,
  );
  try {
    await connection.page.route('https://navigation.test/**', async (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: route.request().url().endsWith('/fade')
          ? `<style>body{margin:0;background:rgb(0,255,0)}
          #cover{position:fixed;inset:0;background:white;animation:reveal 1.9s linear forwards}
          #decoration{position:fixed;inset:0;animation:pulse 0.2s infinite}
          @keyframes reveal{from{opacity:1}to{opacity:0}}
          @keyframes pulse{from{opacity:.1}to{opacity:.2}}</style>
          <h1>Login</h1><input aria-label="Username"><div id="decoration"></div><div id="cover"></div>`
          : `<style>body{margin:0;background:white}</style><script>
          setTimeout(()=>{document.body.style.background='rgb(0,0,255)';document.body.insertAdjacentHTML('beforeend','<h1>Login</h1><input aria-label="Username">')},650)
          </script>`,
      }),
    );
    await evidence.attach(agent);
    for (const [index, step] of steps.entries()) {
      evidence.setStep(step, 0, index);
      await executeScenarioNative(connection.page, step, signal, 0);
      await evidence.recordNativeOutcome(
        agent,
        step,
        0,
        connection.page,
        signal,
      );
    }
    await evidence.finish();
    expect(evidence.error).toBeUndefined();
    expect(run.evidenceLinks.map((link) => link.pageSettled)).toEqual([
      true,
      true,
    ]);
    const html = await readFile(
      join(directory, `${run.id}.evidence.html`),
      'utf8',
    );
    const tags = [...html.matchAll(/<script\b[^<>\r\n]{0,200}>/g)];
    const dumpTag = tags.findLast((match) =>
      match[0].includes('midscene_web_dump'),
    );
    const start = dumpTag.index + dumpTag[0].length;
    const dump = JSON.parse(
      html.slice(start, html.indexOf('</script>', start)),
    );
    const colors = [];
    for (const execution of dump.executions) {
      const reference = execution.tasks[0].recorder[0].screenshot;
      const tag = tags.find((match) =>
        match[0].includes(`data-id="${reference.id}"`),
      );
      const offset = tag.index + tag[0].length;
      const data = html.slice(offset, html.indexOf('</script>', offset)).trim();
      colors.push(
        Array.from(
          await sharp(Buffer.from(data.split(',')[1], 'base64'))
            .extract({ left: 700, top: 500, width: 1, height: 1 })
            .removeAlpha()
            .raw()
            .toBuffer(),
        ),
      );
    }
    expect(colors).toEqual([
      [0, 255, 0],
      [0, 0, 255],
    ]);
    expect(run.evidenceLinks.map((link) => link.stepIds)).toEqual([
      ['fade'],
      ['empty'],
    ]);
  } finally {
    await evidence.finish();
    await connection.close();
    await agent.destroy();
    await page.close();
  }
}, 20000);

it.skipIf(!process.env.STUDIO_OBSERVATION_AI_CDP)(
  'live model distinguishes a transient success, a wrong toast and current state from historical evidence',
  async () => {
    const studio = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${process.env.STUDIO_OBSERVATION_AI_CDP}`,
    });
    let config;
    try {
      const shell = (await studio.pages()).find((p) =>
        p.url().includes('/renderer/index.html'),
      );
      if (!shell) throw new Error('Running Studio shell not found');
      const raw = await shell.evaluate(() =>
        localStorage.getItem('studio:model-env-text'),
      );
      config = Object.fromEntries(
        (raw || '')
          .split(/\r?\n/)
          .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
          .map((line) => {
            const at = line.indexOf('=');
            return [
              line.slice(0, at),
              line
                .slice(at + 1)
                .trim()
                .replace(/^(['"])(.*)\1$/, '$2'),
            ];
          }),
      );
      if (!config.MIDSCENE_MODEL_NAME)
        throw new Error('No saved model configuration');
    } finally {
      await studio.disconnect();
    }
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 600 });
    await page.setContent(
      `<style>body{font:28px Arial;padding:35px}#toast{position:absolute;top:30px;right:30px;background:#15803d;color:white;padding:24px}button{font-size:28px}</style><h1>订单保存</h1><p id="state">当前订单状态：草稿</p><div id="toast" hidden>保存成功</div><button onclick="document.getElementById('toast').hidden=false;document.getElementById('state').innerText='当前订单状态：已提交';setTimeout(()=>document.getElementById('toast').hidden=true,900)">保存</button>`,
    );
    const agent = new PuppeteerAgent(page, {
      modelConfig: config,
      autoPrintReportMsg: false,
      reportFileName: `studio-live-observation-${Date.now()}`,
    });
    const run = {
      id: 'live-observation',
      scenarioId: 's',
      scenarioName: '真实模型多帧断言验证',
      status: 'completed',
      scriptIndex: 0,
      stepIndex: 0,
      scripts: [],
    };
    const evidence = new ScenarioEvidence(directory, run);
    await evidence.attach(agent);
    const session = new ScenarioObservation(
      () => agent,
      () => evidence.flush(),
      1200,
    );
    const signal = AbortSignal.timeout(180000);
    try {
      await session.begin(
        { id: 'save', description: '点击保存', type: 'playwright-operation' },
        signal,
      );
      await page.click('button');
      session.operationCompleted();
      const check = (instruction) =>
        session.assert(
          {
            id: 'assert',
            description: instruction,
            instruction,
            type: 'agent-assertion',
          },
          signal,
        );
      expect(
        (
          await check(
            '点击保存之后出现了“保存成功”提示，当前订单状态是“已提交”。',
          )
        ).pass,
      ).toBe(true);
      expect((await check('点击保存之后出现了“保存失败”提示。')).pass).toBe(
        false,
      );
      expect((await check('当前订单状态为草稿。')).pass).toBe(false);
      // A pre-existing toast is not evidence that the following no-op generated it.
      await session.clear();
      await page.evaluate(() => {
        document.getElementById('toast').hidden = false;
        document.querySelector('button').onclick = () => {};
      });
      await session.begin(
        {
          id: 'noop',
          description: '再次点击保存',
          type: 'playwright-operation',
        },
        signal,
      );
      await page.click('button');
      session.operationCompleted();
      expect((await check('本次点击保存后新出现了“保存成功”提示。')).pass).toBe(
        false,
      );
      await session.clear();
      await evidence.finish();
      run.summary = {
        status: 'completed',
        format: 'html',
        text: renderScenarioHtmlConclusion(run),
      };
      await saveScenarioReport(directory, run);
      const html = await readScenarioHtml(directory, run.id);
      expect(html).toContain('midscene_web_dump');
    } finally {
      await session.clear();
      await evidence.finish();
      await agent.destroy();
      await page.close();
    }
  },
  200000,
);
