import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);

it.runIf(process.platform === 'win32')(
  'releases the process and profile lock across normal, active and stalled shutdowns',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'studio-shutdown-test-'));
    const fixture = createServer((_req, res) =>
      res.end('<title>Shutdown fixture</title><input>'),
    );
    await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
    const modes = ['normal', 'active', 'stalled', 'normal'];
    try {
      for (const [index, mode] of modes.entries()) {
        const reservation = createServer();
        await new Promise((resolve) =>
          reservation.listen(0, '127.0.0.1', resolve),
        );
        const port = reservation.address().port;
        await new Promise((resolve) => reservation.close(resolve));
        const env = {
          ...process.env,
          STUDIO_SHUTDOWN_TEST_ROOT: root,
          STUDIO_SHUTDOWN_TEST_MODE: mode,
          STUDIO_SHUTDOWN_TEST_CYCLE: String(index + 1),
          STUDIO_SHUTDOWN_TEST_PORT: String(port),
          STUDIO_SHUTDOWN_TEST_URL: `http://127.0.0.1:${fixture.address().port}/`,
        };
        env.ELECTRON_RUN_AS_NODE = undefined;
        const child = spawn(
          require('electron'),
          [
            fileURLToPath(
              new URL('./fixtures/shutdown-electron.cjs', import.meta.url),
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
        const timeout = setTimeout(() => child.kill(), 30000);
        try {
          const code = await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', resolve);
          });
          expect(code, output).toBe(0);
          expect(output).toContain('STUDIO_SHUTDOWN_OK');
          if (mode === 'active')
            expect(output).toContain('SHUTDOWN_TASK_ABORTED');
          if (mode === 'stalled')
            expect(output).toContain('cleanup timed out after 5000ms');
          const result = JSON.parse(output.match(/STUDIO_SHUTDOWN_OK (.+)/)[1]);
          expect(result.elapsed).toBeLessThan(8000);
          console.log(`Shutdown ${index + 1} (${mode}): ${result.elapsed}ms`);
        } finally {
          clearTimeout(timeout);
          if (child.exitCode === null) child.kill();
        }
      }
    } finally {
      await new Promise((resolve) => fixture.close(resolve));
    }
  },
  125000,
);
