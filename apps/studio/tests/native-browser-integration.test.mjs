import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);
it.each([1, 2])(
  'report snapshots preserve live rendering, coordinates and hidden layering at display scale %s',
  async (displayScale) => {
    const env = { ...process.env, STUDIO_NATIVE_REPORT_SMOKE: '1' };
    env.ELECTRON_RUN_AS_NODE = undefined;
    const child = spawn(
      require('electron'),
      [
        `--force-device-scale-factor=${displayScale}`,
        fileURLToPath(
          new URL('./fixtures/native-browser-electron.cjs', import.meta.url),
        ),
      ],
      { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    // This probe reads back every 4K compositor frame as well as the report
    // captures. Allow headroom for that diagnostic work on Windows desktops.
    const timer = setTimeout(() => child.kill(), 60000);
    try {
      const code = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', resolve);
      });
      expect(code, output).toBe(0);
      expect(output).toContain('NATIVE_REPORT_SCREENSHOT_OK');
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
    }
  },
  65000,
);
it('native display, recording, replay, overlays and isolated sessions share one target', async () => {
  const env = { ...process.env };
  env.ELECTRON_RUN_AS_NODE = undefined;
  const child = spawn(
    require('electron'),
    [
      fileURLToPath(
        new URL('./fixtures/native-browser-electron.cjs', import.meta.url),
      ),
    ],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const timer = setTimeout(() => child.kill(), 90000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', resolve);
    });
    expect(code, output).toBe(0);
    expect(output).toContain('NATIVE_BROWSER_INTEGRATION_OK');
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
  }
}, 100000);
