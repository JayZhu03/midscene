const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow } = require('electron');

const root = process.env.STUDIO_SHUTDOWN_TEST_ROOT;
const mode = process.env.STUDIO_SHUTDOWN_TEST_MODE;
const cycle = Number(process.env.STUDIO_SHUTDOWN_TEST_CYCLE);
const url = process.env.STUDIO_SHUTDOWN_TEST_URL;
assert(root && url && cycle);
app.setPath('userData', path.join(root, 'profile'));
for (const key of Object.keys(process.env)) {
  if (/^(MIDSCENE_|OPENAI_|DOTENV_)/.test(key)) delete process.env[key];
}
process.env.MIDSCENE_STUDIO_E2E_TEST = '1';
process.env.MIDSCENE_RUN_DIR = path.join(root, 'reports');
process.env.DOTENV_CONFIG_PATH = path.join(root, 'empty.env');
fs.writeFileSync(process.env.DOTENV_CONFIG_PATH, '');

// Exercise the real shell and profile lock without taking focus from the user.
app.on('browser-window-created', (_event, win) => {
  win.on('show', () => win.hide());
});
const { PlaygroundServer } = require('@midscene/playground');
// Use a separate HTTP port as well as a separate Chromium profile.
const launcherFile = path.join(
  path.dirname(require.resolve('@midscene/playground')),
  'platform-launcher.js',
);
const launcher = require(launcherFile);
require.cache[launcherFile].exports = {
  ...launcher,
  launchPreparedPlaygroundPlatform: (prepared, options) =>
    launcher.launchPreparedPlaygroundPlatform(prepared, {
      ...options,
      port: Number(process.env.STUDIO_SHUTDOWN_TEST_PORT),
    }),
};
let server;
const launch = PlaygroundServer.prototype.launch;
PlaygroundServer.prototype.launch = async function (...args) {
  this.app.get('/shutdown-test-stream', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.write('connection intentionally left open');
  });
  server = this;
  return launch.apply(this, args);
};
if (mode === 'stalled') {
  PlaygroundServer.prototype.close = () => {
    console.log('SHUTDOWN_STALLED_CLEANUP');
    return new Promise(() => {});
  };
}
require('../../dist/main/main.cjs');

const timeout = setTimeout(() => {
  console.error('Studio did not exit after window close');
  app.exit(1);
}, 25000);
let closedAt;
app.on('quit', () => {
  clearTimeout(timeout);
  assert(closedAt, 'quit must follow normal window close');
  console.log(
    `STUDIO_SHUTDOWN_OK ${JSON.stringify({ mode, cycle, elapsed: Date.now() - closedAt })}`,
  );
});

app.whenReady().then(async () => {
  try {
    let win;
    for (let i = 0; i < 400; i++) {
      win = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.webContents.isOffscreen(),
      );
      if (
        win &&
        !win.webContents.isLoadingMainFrame() &&
        (await win.webContents.executeJavaScript(
          'Boolean(window.studioRuntime)',
        ))
      )
        break;
      await delay(25);
    }
    assert(win && !win.isDestroyed());
    const previous = await win.webContents.executeJavaScript(
      `localStorage.getItem('shutdown-test-cycle')`,
    );
    assert.equal(
      previous,
      cycle === 1 ? null : String(cycle - 1),
      'settings must survive normal exit and restart',
    );
    await win.webContents.executeJavaScript(
      `localStorage.setItem('shutdown-test-cycle', '${cycle}')`,
    );
    let bootstrap;
    for (let i = 0; i < 150; i++) {
      bootstrap = await win.webContents.executeJavaScript(
        'window.studioRuntime.getPlaygroundBootstrap()',
      );
      if (bootstrap.status !== 'starting') break;
      await delay(50);
    }
    assert.equal(bootstrap.status, 'ready');
    const response = await fetch(`${bootstrap.serverUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platformId: 'web',
        url,
        viewportWidth: 1920,
        viewportHeight: 1080,
      }),
    });
    assert(response.ok, await response.text());
    assert(server, 'must exercise the actual runtime server');

    // A streaming response must not keep HTTP shutdown (and Electron) alive.
    const stream = http.get(`${bootstrap.serverUrl}/shutdown-test-stream`);
    stream.on('error', () => {});
    await new Promise((resolve, reject) => {
      stream.once('response', (res) => {
        res.on('error', () => {});
        res.resume();
        resolve();
      });
      stream.once('error', reject);
    });
    if (mode === 'active') {
      // Simulate in-flight model work that only settles when its signal aborts.
      const controller = new AbortController();
      server.taskAbortControllers['shutdown-test'] = controller;
      server.scenarioCompletion = new Promise((resolve) => {
        controller.signal.addEventListener(
          'abort',
          () => {
            console.log('SHUTDOWN_TASK_ABORTED');
            resolve();
          },
          { once: true },
        );
      });
    }
    closedAt = Date.now();
    win.close();
    // Success deliberately uses normal app.quit(), never app.exit().
  } catch (error) {
    console.error(error.stack);
    clearTimeout(timeout);
    app.exit(1);
  }
});
