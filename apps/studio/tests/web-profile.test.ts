import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { launchPuppeteerPage } from '@midscene/web/puppeteer-agent-launcher';
import { expect, it } from 'vitest';
import {
  launchPersistentWebPage,
  webProfileArgs,
} from '../src/main/playground/web-profile';

it('keeps local storage and session cookies after closing and reopening Chromium', async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'studio-web-profile-test-'),
  );
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Session test</title>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/`;
  let cleanup: { fn: () => void | Promise<void> }[] = [];
  try {
    const target = {
      url,
      viewportWidth: 1376,
      viewportHeight: 864,
      chromeArgs: webProfileArgs(root, url),
    };
    expect(webProfileArgs(root, `${url}orders`)).toEqual(target.chromeArgs);
    expect(webProfileArgs(root, 'https://another.test')[0]).not.toEqual(
      target.chromeArgs[0],
    );
    const first = await launchPersistentWebPage(launchPuppeteerPage, target);
    cleanup = first.freeFn;
    await first.page.evaluate(() => {
      localStorage.setItem('test-login', 'test-user');
      sessionStorage.setItem('test-tab-login', 'tab-user');
      document.cookie = 'test-session=test-session-value; path=/';
    });
    for (const entry of cleanup) await entry.fn();
    cleanup = [];
    const second = await launchPersistentWebPage(launchPuppeteerPage, target);
    cleanup = second.freeFn;
    expect(
      await second.page.evaluate(() => localStorage.getItem('test-login')),
    ).toBe('test-user');
    expect(await second.page.evaluate(() => document.cookie)).toContain(
      'test-session=test-session-value',
    );
    expect(
      await second.page.evaluate(() =>
        sessionStorage.getItem('test-tab-login'),
      ),
    ).toBe('tab-user');
    expect(await second.page.browser().pages()).toHaveLength(1);
    expect(second.page.viewport()).toMatchObject({ width: 1376, height: 864 });
  } finally {
    for (const entry of cleanup) await entry.fn();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
