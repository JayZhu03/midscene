const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow } = require('electron');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-resizable-window-'));
app.setPath('userData', path.join(root, 'profile'));
for (const key of Object.keys(process.env)) {
  if (/^(MIDSCENE_|OPENAI_|DOTENV_)/.test(key)) delete process.env[key];
}
process.env.MIDSCENE_STUDIO_E2E_TEST = '1';
process.env.MIDSCENE_RUN_DIR = path.join(root, 'reports');
process.env.DOTENV_CONFIG_PATH = path.join(root, 'empty.env');
fs.writeFileSync(process.env.DOTENV_CONFIG_PATH, '');

// Exercise the built shell and its actual preload/IPC handlers, using an
// isolated profile so the user's open Studio session is never affected.
require('../../dist/main/main.cjs');

const waitFor = async (predicate) => {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) return;
    await delay(30);
  }
  assert.fail('window state did not settle');
};

app.whenReady().then(async () => {
  let win;
  try {
    await waitFor(() => {
      win = BrowserWindow.getAllWindows().find(
        (window) => !window.webContents.isOffscreen(),
      );
      return win?.isVisible() && !win.webContents.isLoadingMainFrame();
    });
    assert(win.isMaximized(), 'Studio should still start maximized');
    assert(win.isResizable(), 'window edges must remain resizable');
    assert(
      win.isMaximizable(),
      'native maximize/restore control must be enabled',
    );
    assert(win.isMovable(), 'restored window must be movable');
    assert(win.isMinimizable());
    assert(win.isClosable());

    const toggle = () =>
      win.webContents.executeJavaScript(
        'window.electronShell.toggleMaximizeWindow()',
      );
    const checkWindowed = async () => {
      await waitFor(() => !win.isMaximized() && !win.isMinimized());
      // Catch a deferred unmaximize/restore handler reapplying the former lock.
      await delay(250);
      assert(!win.isMaximized(), 'restore must not force maximize again');
    };

    await toggle();
    await checkWindowed();
    win.setSize(1180, 760);
    await waitFor(() => {
      const [width, height] = win.getSize();
      return width === 1180 && height === 760;
    });
    const windowedBounds = win.getBounds();
    win.minimize();
    await waitFor(() => win.isMinimized());
    win.restore();
    await checkWindowed();
    assert.deepEqual(win.getBounds(), windowedBounds);

    // Also exercise the native titlebar path, which bypasses our IPC toggle.
    win.maximize();
    await waitFor(() => win.isMaximized());
    win.unmaximize();
    await checkWindowed();
    assert.deepEqual(win.getBounds(), windowedBounds);

    await toggle();
    await waitFor(() => win.isMaximized());
    win.minimize();
    await waitFor(() => win.isMinimized());
    win.restore();
    await waitFor(() => win.isMaximized() && !win.isMinimized());
    await toggle();
    await checkWindowed();
    assert.deepEqual(win.getBounds(), windowedBounds);

    console.log('RESIZABLE_STUDIO_WINDOW_OK');
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
