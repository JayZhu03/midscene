import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);
it.each([
  { scale: 1, mode: 'GPU', args: [] },
  { scale: 2, mode: 'GPU', args: [] },
  { scale: 1, mode: 'software', args: ['--disable-gpu'] },
  { scale: 2, mode: 'software', args: ['--disable-gpu'] },
])(
  'full-resolution capture, preview and recording at display scale $scale ($mode)',
  async ({ scale, args }) => {
    const env = { ...process.env };
    env.ELECTRON_RUN_AS_NODE = undefined;
    const child = spawn(
      require('electron'),
      [
        `--force-device-scale-factor=${scale}`,
        ...args,
        fileURLToPath(
          new URL('./fixtures/hd-browser-electron.cjs', import.meta.url),
        ),
      ],
      { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    const timer = setTimeout(() => child.kill(), 60000);
    try {
      const code = await new Promise((resolve, reject) => {
        child.on('exit', resolve);
        child.on('error', reject);
      });
      expect(code, output).toBe(0);
      expect(output).toContain('HD_BROWSER_INTEGRATION_OK');
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
    }
  },
  65000,
);
