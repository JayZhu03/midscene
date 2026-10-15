// Real source, production sandboxed preload and actual input forwarding. No model/network dependencies.
const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const ts = require('typescript');
const sharp = require('sharp');
const puppeteer = require('puppeteer');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-hd-browser-test-'));
app.setPath('userData', root);
app.commandLine.appendSwitch('remote-debugging-port', '0');
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
const {
  attachNativeBrowserInput,
} = require('../../src/renderer/components/MainContent/native-browser-input.ts');
const results = [];
const sourceFrames = new Map();
app.on('browser-window-created', (_event, win) => {
  if (!win.webContents.isOffscreen()) return;
  const frames = { texture: 0, bitmap: 0 };
  sourceFrames.set(win.webContents.id, frames);
  win.webContents.on('paint', (event) => {
    frames[event.texture ? 'texture' : 'bitmap']++;
  });
});
let shell;
let server;
let browser;
let active;
const waitFor = async (fn, ms = 8000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await delay(25);
  }
  throw new Error('Timed out');
};
const check = async (name, fn) => {
  const result = await fn();
  results.push({ name, ...result });
  console.log('PASS', name, JSON.stringify(result));
};
const fixture = `<html><head><meta charset="utf-8"><style>body{margin:0;overflow:hidden;background:white}#mark{position:fixed;left:400px;top:400px;width:100px;height:100px;background:rgb(220,20,140)}#stripes{position:fixed;left:800px;top:400px;width:128px;height:100px;background:repeating-linear-gradient(to right,black 0px,black 1px,white 1px,white 2px)}#query{position:absolute;left:300px;top:150px;width:160px;height:60px}#entry{position:absolute;left:300px;top:230px;width:200px;height:50px}#tiny{position:absolute;left:200px;top:450px;width:8px;height:8px;padding:0;border:0}#scroll{position:absolute;left:100px;top:600px;width:200px;height:200px;overflow:auto}#drag{position:absolute;left:600px;top:200px;width:100px;height:100px;background:blue}</style></head><body><div id="mark"></div><div id="stripes"></div><span style="position:fixed;left:1000px;top:400px;font:12px Arial">总 2165 条 / 生产订单</span><form onsubmit="event.preventDefault();window.submits++"><button type="button" id="query" onclick="window.clicks++">Query</button><input id="entry"></form><button id="tiny" onclick="window.tinyClicks++">x</button><div id="scroll"><div style="height:2000px">Scroll</div></div><div id="drag"></div><span id="counter"></span><script>window.clicks=0;window.tinyClicks=0;window.submits=0;window.dragMoves=0;window.dragEnded=false;window.actions=[];document.addEventListener('click',e=>actions.push({id:e.target.id,trusted:e.isTrusted}),true);document.querySelector('#drag').onpointerdown=e=>{e.target.setPointerCapture(e.pointerId);window.dragging=true};document.querySelector('#drag').onpointermove=e=>{if(window.dragging)window.dragMoves++};document.querySelector('#drag').onpointerup=e=>{window.dragging=false;window.dragEnded=true};setInterval(()=>document.querySelector('#counter').textContent=Date.now(),30)</script></body></html>`;
app.whenReady().then(async () => {
  try {
    server = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html;charset=utf-8');
      res.end(
        fixture.replace(
          "setInterval(()=>document.querySelector('#counter').textContent=Date.now(),30)",
          '',
        ),
      );
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    shell = new BrowserWindow({
      width: 1100,
      height: 750,
      show: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        preload: path.join(__dirname, '../../dist/preload/preload.cjs'),
      },
    });
    shell.webContents.on('console-message', (details) => {
      if (details.message?.includes('Error'))
        console.error('RENDERER', details.message);
    });
    shell.webContents.on('preload-error', (_e, _path, error) => {
      throw error;
    });
    await shell.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        '<body style="margin:0;background:#eeeeee"><h3>HD browser integration</h3><div id="frame" style="position:absolute;left:20px;top:80px;width:480px;height:270px"><canvas id="preview" style="width:100%;height:100%;touch-action:none" tabindex="0"></canvas><textarea id="input" style="position:absolute;width:1px;height:24px;opacity:0;pointer-events:none" tabindex="-1"></textarea></div><div id="overlay" style="display:none;position:absolute;left:100px;top:160px;width:150px;height:120px;background:rgb(0,160,80);z-index:10">Dialog</div></body>',
      )}`,
    );
    const host = new NativeBrowserHost(
      () => shell,
      path.join(root, 'profiles'),
    );
    ipcMain.handle('studio:native-browser-input', (event, input) => {
      assert.equal(event.sender, shell.webContents);
      return host.input(input);
    });
    const layout = {
      x: 20,
      y: 80,
      width: 480,
      height: 270,
      visible: true,
      blocked: false,
    };
    await host.updateLayout(layout);
    active = await host.launch({
      url: `http://127.0.0.1:${server.address().port}/`,
      viewportWidth: 1920,
      viewportHeight: 1080,
    });
    const page = active.page;
    const state = await host.updateLayout(layout);
    await shell.webContents.executeJavaScript(
      `document.querySelector('#preview').dataset.studioBrowserId='${state.id}';window.inputErrors=[];window.detachInput=(${attachNativeBrowserInput.toString()})(document.querySelector('#preview'),document.querySelector('#input'),{id:${state.id},width:1920,height:1080,blocked:()=>false,send:window.studioRuntime.nativeBrowserInput,onError:e=>window.inputErrors.push(e.message)});void 0;`,
    );
    await host.updateLayout(layout);
    await waitFor(() => {
      try {
        fs.readFileSync(path.join(root, 'DevToolsActivePort'));
        return true;
      } catch {
        return false;
      }
    });
    const [port, socket] = fs
      .readFileSync(path.join(root, 'DevToolsActivePort'), 'utf8')
      .trim()
      .split(/\r?\n/);
    browser = await puppeteer.connect({
      browserWSEndpoint: `ws://127.0.0.1:${port}${socket}`,
      defaultViewport: null,
    });
    const ui = (await browser.pages()).find((p) =>
      p.url().startsWith('data:text/html'),
    );
    const bytes = async () =>
      Buffer.from(
        (await page.studioNative.captureScreenshot()).split(',')[1],
        'base64',
      );
    const pixel = async (png, x, y) => [
      ...(await sharp(png)
        .extract({ left: x, top: y, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer()),
    ];
    const quality = async (png) => {
      const meta = await sharp(png).metadata();
      assert.equal(meta.width, 1920);
      assert.equal(meta.height, 1080);
      const line = await sharp(png)
        .extract({ left: 800, top: 410, width: 128, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer();
      // High-DPI downsampling blends stripe edges slightly; upscaled preview captures have contrast 0.
      const contrast = Math.abs(
        Array.from(
          { length: 64 },
          (_, i) => line[i * 6] - line[i * 6 + 3],
        ).reduce((a, b) => a + b, 0) / 64,
      );
      assert(contrast > 200, `Lost fine detail: ${contrast}`);
      return { width: meta.width, height: meta.height, contrast };
    };
    const onPage = async (selector) => {
      const p = await page.$eval(selector, (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      const rect = await ui.$eval('#preview', (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      return {
        x: rect.x + (p.x * rect.width) / 1920,
        y: rect.y + (p.y * rect.height) / 1080,
      };
    };
    const click = async (selector) => {
      const p = await onPage(selector);
      await ui.mouse.click(p.x, p.y);
    };
    const value = () => page.$eval('#entry', (el) => el.value);
    await check(
      'the production screenshot source contains real one-pixel detail',
      async () => {
        await waitFor(() =>
          ui.$eval(
            '#preview',
            (c) =>
              c.width === 1920 * devicePixelRatio &&
              c.height === 1080 * devicePixelRatio,
          ),
        );
        const png = await bytes();
        fs.writeFileSync(path.join(root, 'full-resolution.png'), png);
        const source = BrowserWindow.getAllWindows().find(
          (w) => w.webContents.id === state.id,
        );
        const gpuCompositing = app.getGPUFeatureStatus().gpu_compositing;
        const frames = sourceFrames.get(state.id);
        if (
          app.isHardwareAccelerationEnabled() &&
          gpuCompositing === 'enabled' &&
          !app.commandLine.hasSwitch('disable-gpu') &&
          !app.commandLine.hasSwitch('disable-gpu-compositing')
        ) {
          await waitFor(() => frames.texture > 0);
        }
        return {
          ...(await quality(png)),
          offscreen: source.webContents.isOffscreen(),
          hardwareAcceleration: app.isHardwareAccelerationEnabled(),
          gpuCompositing,
          previewFrames: { ...frames },
        };
      },
    );
    await check(
      'preview and window resize preserve page resolution and fidelity',
      async () => {
        const previews = [];
        for (const width of [320, 960, 480]) {
          await ui.$eval(
            '#frame',
            (el, w) => {
              el.style.width = `${w}px`;
              el.style.height = `${(w * 1080) / 1920}px`;
            },
            width,
          );
          await host.updateLayout({
            ...layout,
            width,
            height: (width * 1080) / 1920,
          });
          previews.push({
            previewWidth: width,
            ...(await quality(await bytes())),
          });
          assert.deepEqual(
            await page.evaluate(() => [innerWidth, innerHeight]),
            [1920, 1080],
          );
        }
        shell.setContentSize(800, 600);
        await quality(await bytes());
        shell.setContentSize(1100, 750);
        return { previews };
      },
    );
    const recorded = [];
    await page.studioNative.startRecording((packet) => recorded.push(packet));
    await check(
      'scaled clicks, fast typing, selection and Chinese input reach the same page once',
      async () => {
        await click('#query');
        await click('#entry');
        await ui.keyboard.type('Super');
        await waitFor(async () => (await value()) === 'Super');
        await ui.keyboard.press('ArrowLeft');
        await ui.keyboard.press('Backspace');
        await ui.keyboard.sendCharacter('中文');
        await waitFor(async () => (await value()) === 'Sup中文r');
        await ui.keyboard.down('Control');
        await ui.keyboard.press('A');
        await ui.keyboard.up('Control');
        await ui.keyboard.type('Replace');
        await waitFor(async () => (await value()) === 'Replace');
        const oldClipboard = clipboard.readText();
        try {
          clipboard.writeText('粘贴');
          await ui.keyboard.down('Control');
          await ui.keyboard.press('A');
          await ui.keyboard.press('V');
          await ui.keyboard.up('Control');
          await waitFor(async () => (await value()) === '粘贴');
        } finally {
          clipboard.writeText(oldClipboard);
        }
        await ui.keyboard.press('Enter');
        await waitFor(() => page.evaluate(() => window.submits === 1));
        assert.equal(await page.evaluate(() => window.clicks), 1);
        return {
          value: await value(),
          submits: await page.evaluate(() => window.submits),
        };
      },
    );
    await check(
      'small clear controls and rapid clicks are recorded without loss',
      async () => {
        for (let i = 0; i < 20; i++) await click('#tiny');
        await waitFor(() => page.evaluate(() => window.tinyClicks === 20));
        assert(
          (await page.evaluate(() => window.actions))
            .filter((e) => e.id === 'tiny')
            .every((e) => e.trusted),
        );
        return { clicks: 20 };
      },
    );
    await check(
      'wheel and pointer drag cross preview coordinates accurately',
      async () => {
        const point = await onPage('#scroll');
        await ui.mouse.move(point.x, point.y);
        await ui.mouse.wheel({ deltaY: 120 });
        await waitFor(() => page.$eval('#scroll', (el) => el.scrollTop > 0));
        const drag = await onPage('#drag');
        await ui.mouse.move(drag.x, drag.y);
        await ui.mouse.down();
        await ui.mouse.move(drag.x + 70, drag.y + 30, { steps: 8 });
        await ui.mouse.up();
        await waitFor(() =>
          page.evaluate(() => window.dragEnded && window.dragMoves > 0),
        );
        return {
          scrollTop: await page.$eval('#scroll', (el) => el.scrollTop),
          dragMoves: await page.evaluate(() => window.dragMoves),
        };
      },
    );
    await page.studioNative.stopRecording();
    await check(
      'the existing recorder keeps native targets and full-resolution evidence',
      async () => {
        assert(recorded.some((p) => p.nativeTarget?.locator));
        assert(recorded.some((p) => p.payload.actionType === 'Input'));
        assert(recorded.some((p) => p.screenshot));
        await quality(
          Buffer.from(
            recorded.find((p) => p.screenshot).screenshot.split(',')[1],
            'base64',
          ),
        );
        return { recorded: recorded.length };
      },
    );
    await check(
      'manual input is blocked during execution without blocking automation',
      async () => {
        await host.updateLayout({ ...layout, blocked: true });
        await click('#query');
        await delay(100);
        assert.equal(await page.evaluate(() => window.clicks), 1);
        await page.click('#query');
        assert.equal(await page.evaluate(() => window.clicks), 2);
        await host.updateLayout(layout);
        return { blocked: true };
      },
    );
    await check(
      'repeated screenshots do not resize the live surface',
      async () => {
        const source = BrowserWindow.getAllWindows().find(
          (w) => w.webContents.id === state.id,
        );
        const sizes = new Set();
        source.webContents.beginFrameSubscription((image) => {
          const size = image.getSize();
          sizes.add(`${size.width}x${size.height}`);
        });
        const durations = [];
        for (let i = 0; i < 15; i++) {
          await page.$eval(
            '#counter',
            (el, value) => {
              el.textContent = String(value);
            },
            i,
          );
          const start = Date.now();
          await quality(await bytes());
          durations.push(Date.now() - start);
        }
        source.webContents.endFrameSubscription();
        assert.equal(sizes.size, 1);
        return {
          surfaceSizes: [...sizes],
          meanMs: Math.round(
            durations.reduce((a, b) => a + b, 0) / durations.length,
          ),
        };
      },
    );
    await check(
      'minimized Studio returns new evidence without restoring the window',
      async () => {
        shell.minimize();
        await waitFor(() => shell.isMinimized());
        await host.updateLayout({ ...layout, visible: false });
        for (const color of [
          [210, 70, 30],
          [25, 160, 230],
          [220, 20, 140],
          [190, 240, 40],
          [80, 10, 200],
          [230, 70, 180],
        ]) {
          await page.evaluate((c) => {
            document.querySelector('#mark').style.background =
              `rgb(${c.join(',')})`;
          }, color);
          const png = await bytes();
          await quality(png);
          assert.deepEqual(await pixel(png, 450, 450), color);
          assert(shell.isMinimized());
        }
        shell.restore();
        await host.updateLayout(layout);
        return { freshFrames: 6 };
      },
    );
    await check(
      'shell overlays cover the preview without native views or a screenshot flash',
      async () => {
        await ui.$eval('#overlay', (el) => {
          el.style.display = 'block';
        });
        await delay(100);
        const image = await shell.webContents.capturePage();
        const png = image.toPNG();
        const meta = await sharp(png).metadata();
        const scale = meta.width / shell.getContentSize()[0];
        assert.deepEqual(
          await pixel(png, Math.round(132 * scale), Math.round(192 * scale)),
          [0, 160, 80],
        );
        assert(
          shell.contentView.children.every(
            (v) => !v.webContents || v.webContents.id === shell.webContents.id,
          ),
        );
        await quality(await bytes());
        return { covered: true };
      },
    );
    await check(
      'preview transfers recover after a busy renderer and a missing canvas',
      async () => {
        await ui.$eval('#overlay', (el) => {
          el.style.display = 'none';
        });
        const previewPixel = () =>
          ui.$eval('#preview', (canvas) => {
            const x = Math.round((450 * canvas.width) / 1920);
            const y = Math.round((450 * canvas.height) / 1080);
            return [
              ...canvas.getContext('2d').getImageData(x, y, 1, 1).data,
            ].slice(0, 3);
          });
        const colors = [
          [240, 80, 10],
          [30, 170, 240],
        ];
        await ui.evaluate(() => {
          document.querySelector('#preview').dataset.studioBrowserId = '';
        });
        await delay(100);
        await page.evaluate((c) => {
          document.querySelector('#mark').style.background =
            `rgb(${c.join(',')})`;
        }, colors[0]);
        await delay(150);
        await ui.evaluate((id) => {
          document.querySelector('#preview').dataset.studioBrowserId = id;
        }, String(state.id));
        await host.updateLayout(layout);
        await waitFor(
          async () => (await previewPixel()).join() === colors[0].join(),
        );
        const busy = ui.evaluate(() => {
          const end = performance.now() + 1500;
          while (performance.now() < end) {}
        });
        await page.evaluate((c) => {
          document.querySelector('#mark').style.background =
            `rgb(${c.join(',')})`;
        }, colors[1]);
        await busy;
        await waitFor(
          async () => (await previewPixel()).join() === colors[1].join(),
        );
        const before = await value();
        await host.input({
          id: state.id + 10000,
          type: 'insertText',
          text: 'stale',
        });
        assert.equal(await value(), before);
        return { recovered: true, ignoredStaleTarget: true };
      },
    );
    await check('navigation clears the former preview zoom', async () => {
      const source = BrowserWindow.getAllWindows().find(
        (w) => w.webContents.id === state.id,
      );
      source.webContents.setZoomFactor(0.5);
      await page.reload({ waitUntil: 'load' });
      await waitFor(() =>
        page.evaluate(() => innerWidth === 1920 && innerHeight === 1080),
      );
      assert.equal(source.webContents.getZoomFactor(), 1);
      await quality(await bytes());
      return { zoom: 1 };
    });
    assert.deepEqual(await ui.evaluate(() => window.inputErrors), []);
    console.log('HD_BROWSER_INTEGRATION_OK', JSON.stringify({ root, results }));
    for (const cleanup of active.freeFn) await cleanup.fn();
    await browser.disconnect();
    shell.destroy();
    server.close();
    app.exit(0);
  } catch (error) {
    console.error(error.stack);
    console.error('CHECKS', JSON.stringify(results));
    app.exit(1);
  }
});
