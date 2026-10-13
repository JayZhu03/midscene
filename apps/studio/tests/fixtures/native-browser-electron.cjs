// Real Electron integration; isolated profile, local fixture, no model or MOM writes.
const { app, BrowserWindow } = require('electron');
process.on('uncaughtException', (error) => {
  console.error(error.stack);
  app.exit(1);
});
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const http = require('node:http');
const ts = require('typescript');
const { setTimeout: delay } = require('node:timers/promises');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-native-test-'));
app.setPath('userData', root);
app.commandLine.appendSwitch('remote-debugging-port', '0');
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
process.env.MIDSCENE_RUN_DIR = path.join(root, 'reports');
require.extensions['.ts'] = (mod, file) =>
  mod._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    `${file}.cjs`,
  );
const {
  NativeBrowserHost,
} = require('../../src/main/playground/native-browser.ts');
const { PuppeteerAgent } = require('@midscene/web/puppeteer');
const { PlaygroundServer } = require('@midscene/playground');
const {
  connectScenarioPage,
  executeScenarioNative,
} = require('../../../../packages/playground/src/scenario-native.ts');
let shell;
let server;
let pg;
let connection;
let active;
const checks = [];
const fixture =
  '<html><body><input id="value" aria-label="Value"><button id="query" onclick="document.querySelector(\'#result\').textContent=++window.count">Query</button><output id="result">0</output><button id="jump" onclick="location.href=\'/next\'">Next</button><div id="scroll" style="width:200px;height:100px;overflow:auto"><div style="height:2000px">Scroll content</div></div><script>window.count=0;</script></body></html>';
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}
app.whenReady().then(async () => {
  try {
    server = http.createServer((_req, res) => {
      if (_req.url === '/unavailable') {
        _req.socket.destroy();
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      if (_req.url === '/slow-document') {
        setTimeout(() => res.end(fixture), 500);
        return;
      }
      res.end(fixture);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/`;
    shell = new BrowserWindow({
      width: 1100,
      height: 750,
      show: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    await shell.loadURL(
      'data:text/html,<h1>Studio native browser integration</h1>',
    );
    const host = new NativeBrowserHost(
      () => shell,
      path.join(root, 'profiles'),
    );
    const layout = {
      x: 10,
      y: 80,
      width: 960,
      height: 540,
      visible: true,
      blocked: false,
    };
    await host.updateLayout(layout);
    active = await host.launch({
      url,
      viewportWidth: 1920,
      viewportHeight: 1080,
      chromeArgs: [`--user-data-dir=${path.join(root, 'old')}`],
    });
    const page = active.page;
    const guest = () =>
      shell.contentView.children.find(
        (v) =>
          v.webContents &&
          v.webContents.id !== shell.webContents.id &&
          !v.webContents.isDestroyed() &&
          v.getVisible(),
      );
    const click = async (selector) => {
      shell.show();
      shell.focus();
      const v = guest();
      v.webContents.focus();
      await delay(80);
      const p = await page.$eval(selector, (e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      const z = v.webContents.getZoomFactor();
      for (const type of ['mouseMove', 'mouseDown', 'mouseUp'])
        v.webContents.sendInputEvent({
          type,
          x: Math.round(p.x * z),
          y: Math.round(p.y * z),
          button: 'left',
          clickCount: 1,
        });
      await delay(300);
    };
    await check('logical viewport and native zoom', async () => {
      assert.deepEqual(
        await page.evaluate(() => [innerWidth, innerHeight]),
        [1920, 1080],
      );
      assert.equal(guest().webContents.getZoomFactor(), 0.5);
    });
    await check('native trusted click', async () => {
      await click('#query');
      assert.equal(await page.$eval('#result', (e) => e.textContent), '1');
    });
    const agent = new PuppeteerAgent(page, { generateReport: false });
    Object.assign(agent.interface, { studioNative: page.studioNative });
    const reservation = http.createServer();
    await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
    const port = reservation.address().port;
    await new Promise((r) => reservation.close(r));
    pg = new PlaygroundServer(agent);
    await pg.launch(port);
    const api = async (route, body) => {
      const res = await fetch(`http://127.0.0.1:${pg.port}${route}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await res.json();
      assert(res.ok, JSON.stringify(data));
      return data;
    };
    await check(
      'native recording enters existing server pipeline',
      async () => {
        assert(
          (await api('/recorder/start', { sessionId: 'native-integration' }))
            .ok,
        );
        await click('#query');
        await click('#value');
        await guest().webContents.insertText('native value');
        await api('/recorder/stop', {});
        const data = await api('/recorder/events');
        assert(
          data.events.some(
            (e) => e.actionType === 'Tap' && e.nativeTarget?.locator,
          ),
        );
        assert(
          data.events.some(
            (e) =>
              e.actionType === 'Input' &&
              e.value === 'native value' &&
              e.nativeTarget?.locator,
          ),
        );
        const event = data.events.find((e) => e.actionType === 'Tap');
        connection = await connectScenarioPage(
          agent.interface,
          new AbortController().signal,
        );
        const before = await page.evaluate(() => window.count);
        await executeScenarioNative(
          connection.page,
          { event },
          new AbortController().signal,
          0,
        );
        assert.equal(await page.evaluate(() => window.count), before + 1);
      },
    );
    await check('automation while manual input blocked', async () => {
      await host.updateLayout({ ...layout, blocked: true });
      await connection.page.locator('#query').click();
      assert.equal(await page.evaluate(() => window.count), 4);
      await host.updateLayout(layout);
    });
    await check(
      'overlay hides native view and returns still image',
      async () => {
        const state = await host.updateLayout({ ...layout, visible: false });
        assert(state.snapshot?.startsWith('data:image'));
        assert(!guest());
        await host.updateLayout(layout);
        await click('#query');
        assert.equal(await page.evaluate(() => window.count), 5);
      },
    );
    await check('viewport replay uses host geometry', async () => {
      await connection.page.setViewportSize({ width: 1280, height: 720 });
      assert.deepEqual(
        await page.evaluate(() => [innerWidth, innerHeight]),
        [1280, 720],
      );
      await connection.page.locator('#query').click();
    });
    await check(
      'fresh session isolates cookies and storage and restores target',
      async () => {
        await page.evaluate(() => {
          localStorage.setItem('session-proof', 'original');
          document.cookie = 'proof=original;path=/';
        });
        const fresh = await host.launch({
          url,
          viewportWidth: 1920,
          viewportHeight: 1080,
        });
        assert.equal(
          await fresh.page.evaluate(() =>
            localStorage.getItem('session-proof'),
          ),
          null,
        );
        assert.equal(await fresh.page.evaluate(() => document.cookie), '');
        page.studioNative.activate();
        await fresh.freeFn[0].fn();
        assert.equal(
          await page.evaluate(() => localStorage.getItem('session-proof')),
          'original',
        );
        await click('#query');
      },
    );
    await check(
      'recorder reinjection after full document navigation',
      async () => {
        await api('/recorder/start', { sessionId: 'native-navigation' });
        await click('#jump');
        await page.waitForFunction(() => location.pathname === '/next');
        await click('#query');
        await api('/recorder/stop', {});
        const { events } = await api('/recorder/events');
        assert(events.filter((e) => e.actionType === 'Tap').length >= 2);
      },
    );
    await check(
      'double-click and wheel gestures record once and replay',
      async () => {
        await api('/recorder/start', { sessionId: 'native-gestures' });
        await connection.page.locator('#query').dblclick();
        await connection.page.locator('#scroll').hover();
        await connection.page.mouse.wheel(0, 120);
        await connection.page.mouse.wheel(0, 120);
        await delay(220);
        await api('/recorder/stop', {});
        const { events } = await api('/recorder/events');
        assert.equal(
          events.filter((e) => e.actionType === 'DoubleClick').length,
          1,
        );
        assert.equal(events.filter((e) => e.actionType === 'Tap').length, 0);
        const scroll = events.find((e) => e.actionType === 'Scroll');
        assert(scroll?.nativeTarget?.locator, JSON.stringify(scroll));
        await connection.page.locator('#scroll').evaluate((e) => {
          e.scrollTop = 0;
        });
        await executeScenarioNative(
          connection.page,
          { event: scroll },
          new AbortController().signal,
          0,
        );
        assert(
          (await connection.page
            .locator('#scroll')
            .evaluate((e) => e.scrollTop)) > 0,
        );
      },
    );
    await check(
      'failed main-document navigation stays failed through the error document and recovers',
      async () => {
        const state = await host.updateLayout(layout);
        const view = shell.contentView.children.find(
          (v) => v.webContents?.id === state.id,
        );
        await page.goto(`${url}unavailable`).catch(() => {});
        await page.waitForFunction(() => document.readyState === 'complete');
        const failed = await host.updateLayout(layout);
        assert(failed.error?.includes('ERR_'), JSON.stringify(failed));
        assert.equal(view.getVisible(), false);
        await page.goto(url);
        const recovered = await host.updateLayout(layout);
        assert.equal(recovered.error, undefined);
        assert.equal(view.getVisible(), true);
      },
    );
    await check(
      'native navigation exposes pending connection time and clears it on readiness',
      async () => {
        const navigation = page.goto(`${url}slow-document`);
        await delay(100);
        assert.equal(
          typeof (await host.updateLayout(layout)).loadingSince,
          'number',
        );
        await navigation;
        assert.equal((await host.updateLayout(layout)).loadingSince, undefined);
      },
    );
    await check(
      'animated DOM border surrounds rather than sits beneath the native surface',
      async () => {
        const css = fs.readFileSync(
          path.join(
            __dirname,
            '../../src/renderer/components/MainContent/MobilePreviewFrame.css',
          ),
          'utf8',
        );
        const bounds = await shell.webContents.executeJavaScript(`(() => {
        const style = document.createElement('style'); style.textContent=${JSON.stringify(css)};document.head.append(style);
        const parent = document.createElement('div'); parent.className='mobile-preview-frame-viewport-active';
        parent.style.cssText='position:absolute;left:10px;top:80px;width:960px;height:540px';
        parent.innerHTML='<div class="studio-native-preview-stage" style="--native-preview-ratio:1.7777777778;--native-preview-fit-width:calc(177.77777778cqh - 14.22222222px);--native-preview-fit-height:calc(56.25cqw - 4.5px)"><div class="studio-native-preview-frame"></div></div>';
        document.body.append(parent);const frame=parent.querySelector('.studio-native-preview-frame');
        const rect=frame.getBoundingClientRect(), active=getComputedStyle(frame,'::after').animationName;
        parent.className='';const inactive=getComputedStyle(frame,'::after').animationName;parent.className='mobile-preview-frame-viewport-active';
        return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,active,inactive};
      })()`);
        assert.equal(bounds.active, 'mobile-preview-marquee');
        assert.equal(bounds.inactive, 'none');
        assert(bounds.width < 960 && bounds.height < 540);
        const { x, y, width, height } = bounds;
        const state = await host.updateLayout({
          x,
          y,
          width,
          height,
          visible: true,
          blocked: false,
        });
        const view = shell.contentView.children.find(
          (v) => v.webContents?.id === state.id,
        );
        const actual = view.getBounds();
        assert(Math.abs(actual.x - x) <= 1 && Math.abs(actual.y - y) <= 1);
        assert(
          Math.abs(actual.width - width) <= 1 &&
            Math.abs(actual.height - height) <= 1,
        );
        await host.updateLayout(layout);
      },
    );
    await check('closing guest does not close Electron or shell', async () => {
      await page.evaluate(() =>
        sessionStorage.setItem('session-token', 'keep-me'),
      );
      await connection.close();
      connection = null;
      await pg.close();
      pg = null;
      await active.freeFn[0].fn();
      active = null;
      assert(!shell.isDestroyed());
    });
    await check(
      'reopening profile restores session storage and login cookie',
      async () => {
        active = await host.launch({
          url,
          viewportWidth: 1920,
          viewportHeight: 1080,
          chromeArgs: [`--user-data-dir=${path.join(root, 'old')}`],
        });
        assert.equal(
          await active.page.evaluate(() =>
            sessionStorage.getItem('session-token'),
          ),
          'keep-me',
        );
        assert(
          (await active.page.evaluate(() => document.cookie)).includes(
            'proof=original',
          ),
        );
        assert.equal(
          await active.page.evaluate(() =>
            localStorage.getItem('session-proof'),
          ),
          'original',
        );
        await active.freeFn[0].fn();
        active = null;
      },
    );
    await check(
      'legacy Chromium login migrates without sharing profile files',
      async () => {
        const puppeteer = require('puppeteer');
        const profile = path.join(root, 'legacy-profile');
        const oldBrowser = await puppeteer.launch({
          headless: true,
          userDataDir: profile,
        });
        try {
          const oldPage = await oldBrowser.newPage();
          await oldPage.goto(url);
          await oldPage.evaluate(() => {
            localStorage.setItem('legacy-local', 'retained');
            sessionStorage.setItem('legacy-session', 'retained');
            document.cookie = 'legacy-cookie=retained;path=/';
          });
          const migratedHost = new NativeBrowserHost(
            () => shell,
            path.join(root, 'migrated-profiles'),
          );
          await migratedHost.updateLayout(layout);
          const migrated = await migratedHost.launch(
            {
              url,
              viewportWidth: 1920,
              viewportHeight: 1080,
              chromeArgs: [`--user-data-dir=${profile}`],
            },
            async () => ({
              page: oldPage,
              freeFn: [{ fn: () => oldBrowser.close() }],
            }),
          );
          assert.deepEqual(
            await migrated.page.evaluate(() => [
              localStorage.getItem('legacy-local'),
              sessionStorage.getItem('legacy-session'),
            ]),
            ['retained', 'retained'],
          );
          assert(
            (await migrated.page.evaluate(() => document.cookie)).includes(
              'legacy-cookie=retained',
            ),
          );
          await migrated.freeFn[0].fn();
        } finally {
          await oldBrowser.close();
        }
      },
    );
    console.log(`NATIVE_BROWSER_INTEGRATION_OK ${JSON.stringify(checks)}`);
    app.exit(0);
  } catch (error) {
    console.error(error.stack);
    app.exit(1);
  }
});
