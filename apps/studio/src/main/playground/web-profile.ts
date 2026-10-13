import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { launchPuppeteerPage } from '@midscene/web/puppeteer-agent-launcher';
import puppeteer, { type Page } from 'puppeteer';
import { DEFAULT_STUDIO_WEB_VIEWPORT } from '../../shared/web-viewport';

/** Stable per-site browser storage, isolated from the user's normal Chrome. */
export function webProfileArgs(root: string, url: string): string[] {
  const origin = new URL(url).origin;
  const key = createHash('sha256').update(origin).digest('hex');
  const directory = path.join(root, key);
  mkdirSync(directory, { recursive: true });
  return [`--user-data-dir=${directory}`, '--restore-last-session'];
}

/** Reuse the restored tab so sessionStorage survives too, without accumulating
 * another background tab on every Studio restart. */
export async function launchPersistentWebPage(
  launchPage: typeof launchPuppeteerPage,
  target: Parameters<typeof launchPuppeteerPage>[0],
  preference?: Parameters<typeof launchPuppeteerPage>[1],
): Promise<{
  page: Page;
  freeFn: Array<{ name: string; fn: () => void | Promise<void> }>;
}> {
  if (!target.chromeArgs?.some((arg) => arg.startsWith('--user-data-dir='))) {
    return launchPage(target, preference);
  }
  const width = target.viewportWidth ?? DEFAULT_STUDIO_WEB_VIEWPORT.width;
  const height = target.viewportHeight ?? DEFAULT_STUDIO_WEB_VIEWPORT.height;
  const browser = await puppeteer.launch({
    headless: !preference?.headed,
    defaultViewport: { width, height },
    args: [...target.chromeArgs, `--window-size=${width},${height + 100}`],
  });
  try {
    const pages = await browser.pages();
    const origin = new URL(target.url).origin;
    const page =
      pages.find((item) => {
        try {
          return new URL(item.url()).origin === origin;
        } catch {
          return false;
        }
      }) ??
      pages[0] ??
      (await browser.newPage());
    const prepared = await launchPage(target, preference, browser, page);
    // Chrome may finish restoring background tabs during navigation. Refresh
    // the list here rather than using the launch-time snapshot.
    for (const other of await browser.pages()) {
      if (other !== page) await other.close();
    }
    return {
      page: prepared.page,
      freeFn: [
        { name: 'studio_persistent_browser', fn: () => browser.close() },
      ],
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
