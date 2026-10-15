import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
it.runIf(process.platform === 'win32')(
  'starts maximized while allowing resize, maximize toggle and minimize/restore',
  async () => {
    const env = { ...process.env };
    env.ELECTRON_RUN_AS_NODE = undefined;
    const child = spawn(
      require('electron'),
      [
        fileURLToPath(
          new URL('./fixtures/resizable-window-electron.cjs', import.meta.url),
        ),
      ],
      {
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const timer = setTimeout(() => child.kill(), 30000);
    try {
      const code = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', resolve);
      });
      expect(code, output).toBe(0);
      expect(output).toContain('RESIZABLE_STUDIO_WINDOW_OK');
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
    }
  },
  35000,
);
