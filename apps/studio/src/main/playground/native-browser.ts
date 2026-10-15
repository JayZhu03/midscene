import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { getDebug } from '@midscene/shared/logger';
import type { MidsceneRecorderNativeTarget } from '@midscene/shared/recorder';
import {
  BrowserWindow,
  type CookiesSetDetails,
  app,
  safeStorage,
  session,
} from 'electron';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  type NativeBrowserLayout,
  type NativeBrowserState,
  validNativeBrowserInput,
  validNativeBrowserLayout,
} from '../../shared/native-browser';
import { nativeBrowserUsesSharedTexture } from './native-browser-gpu';
import { attachNativeBrowserPreview } from './native-browser-preview';
import { encodeNativeBrowserScreenshot } from './native-browser-screenshot';
import { nativeRecorderScript } from './native-recorder';
import {
  createRecorderDelivery,
  stopRecorderDelivery,
} from './native-recorder-delivery';

const debug = getDebug('studio:native-browser', { console: true });
const nativeRequire = createRequire(__filename);
type Packet = {
  payload: Record<string, unknown>;
  nativeTarget?: MidsceneRecorderNativeTarget;
  url: string;
  title: string;
  width: number;
  height: number;
  subframe?: boolean;
  screenshot?: string;
  clickTarget?: string;
  clickCount?: number;
};
type RecordListener = (packet: Packet) => void;
export interface NativePageHooks {
  activate(): void;
  captureScreenshot(): Promise<string>;
  startRecording(listener: RecordListener): Promise<void>;
  stopRecording(): Promise<void>;
  setViewport(size: { width: number; height: number }): Promise<void>;
}
export type NativePage = Page & { studioNative?: NativePageHooks };
type Guest = {
  view: BrowserWindow;
  page: NativePage;
  browser: Browser;
  width: number;
  height: number;
  error?: string;
  loadingSince?: number;
  stopRecording: () => Promise<void>;
  stopPreview: () => void;
  updatePreview: () => void;
  inputQueue: Promise<void>;
};

/** A single owner for display and automation. Never browser.close() on Electron. */
export class NativeBrowserHost {
  private active?: Guest;
  private layout?: NativeBrowserLayout;
  constructor(
    private window: () => BrowserWindow | null,
    private root: string,
  ) {}

  private async endpoint() {
    const port = app.commandLine.getSwitchValue('remote-debugging-port');
    if (port && port !== '0') return `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
      try {
        const value = await readFile(
          path.join(app.getPath('userData'), 'DevToolsActivePort'),
          'utf8',
        );
        const [actualPort, socket] = value.trim().split(/\r?\n/);
        if (
          /^\d+$/.test(actualPort) &&
          socket?.startsWith('/devtools/browser/')
        )
          return `ws://127.0.0.1:${actualPort}${socket}`;
      } catch {
        /* Chromium writes this after its IO thread starts. */
      }
      await delay(50);
    }
    throw new Error('原生浏览器连接未就绪，请重启 Studio。');
  }

  private place() {
    const guest = this.active;
    const layout = this.layout;
    if (
      !guest ||
      guest.view.isDestroyed() ||
      guest.view.webContents.isDestroyed()
    )
      return;
    // The preview never changes the webpage's render dimensions or zoom.
    if (
      layout?.visible &&
      !guest.error &&
      layout.width >= 2 &&
      layout.height >= 2
    )
      guest.updatePreview();
  }

  async input(value: unknown): Promise<void> {
    if (!validNativeBrowserInput(value))
      throw new Error('Invalid browser input');
    const guest = this.active;
    if (
      !guest ||
      guest.view.isDestroyed() ||
      guest.view.webContents.isDestroyed()
    )
      return;
    const run = guest.inputQueue.then(async () => {
      if (
        this.active !== guest ||
        guest.view.isDestroyed() ||
        value.id !== guest.view.webContents.id ||
        !this.layout?.visible ||
        this.layout.blocked ||
        guest.error ||
        guest.view.webContents.isDestroyed()
      )
        return;
      const wc = guest.view.webContents;
      if (value.type === 'insertText') await wc.insertText(value.text);
      else if (value.type === 'shortcut') wc[value.action]();
      else {
        const { id: _id, ...event } = value;
        if (event.type === 'mouseWheel')
          wc.sendInputEvent({
            ...event,
            deltaX: -event.deltaX,
            deltaY: -event.deltaY,
          });
        else wc.sendInputEvent(event);
        if (event.type === 'keyDown' && event.keyCode === 'Return')
          wc.sendInputEvent({
            type: 'char',
            keyCode: '\r',
            modifiers: event.modifiers,
          });
      }
    });
    guest.inputQueue = run.catch(() => {});
    return run;
  }

  async updateLayout(value: unknown): Promise<NativeBrowserState> {
    if (!validNativeBrowserLayout(value))
      throw new Error('Invalid native browser bounds');
    const win = this.window();
    const [width, height] = win?.getContentSize() ?? [0, 0];
    const layout = {
      ...value,
      width: Math.max(0, Math.min(value.width, width - value.x)),
      height: Math.max(0, Math.min(value.height, height - value.y)),
    };
    const guest =
      this.active && !this.active.view.isDestroyed() ? this.active : undefined;
    this.layout = layout;
    this.place();
    return guest
      ? {
          available: true,
          id: guest.view.webContents.id,
          width: guest.width,
          height: guest.height,
          error: guest.error,
          loadingSince: guest.loadingSince,
        }
      : { available: false };
  }

  async launch(
    target: {
      url: string;
      viewportWidth: number;
      viewportHeight: number;
      chromeArgs?: string[];
    },
    migrate?: () => Promise<{
      page: unknown;
      freeFn: { fn: () => void | Promise<void> }[];
    }>,
  ) {
    const win = this.window();
    if (!win || win.isDestroyed())
      throw new Error('Studio window is unavailable');
    const previousGuest = this.active;
    const profile = target.chromeArgs
      ?.find((a) => a.startsWith('--user-data-dir='))
      ?.slice('--user-data-dir='.length);
    const key = createHash('sha256')
      .update(new URL(target.url).origin)
      .digest('hex');
    const directory = path.join(this.root, key);
    const sessionFile = path.join(directory, 'studio-session.bin');
    const guestSession = profile
      ? session.fromPath(directory)
      : session.fromPartition(`studio-run-${randomUUID()}`);
    const useSharedTexture = await nativeBrowserUsesSharedTexture();
    if (win.isDestroyed()) throw new Error('Studio window is unavailable');
    const view = new BrowserWindow({
      width: target.viewportWidth,
      height: target.viewportHeight,
      useContentSize: true,
      show: false,
      frame: false,
      skipTaskbar: true,
      webPreferences: {
        session: guestSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        offscreen: { useSharedTexture },
      },
    });
    // Windows clamps the initial bounds to the monitor's work area.
    view.setContentSize(target.viewportWidth, target.viewportHeight);
    const resetZoom = () => {
      // The former native preview saved its fitted zoom per origin. Existing
      // profiles must render at full size too, including after redirects.
      if (view.webContents.getZoomFactor() !== 1)
        view.webContents.setZoomFactor(1);
    };
    resetZoom();
    view.webContents.on('did-navigate', resetZoom);
    view.webContents.setFrameRate(useSharedTexture ? 30 : 10);
    const closeWithShell = () => {
      if (!view.isDestroyed()) view.destroy();
    };
    win.once('closed', closeWithShell);
    const preview = attachNativeBrowserPreview(
      view.webContents,
      win.webContents,
      () =>
        this.active?.view === view &&
        Boolean(this.layout?.visible) &&
        !this.active.error,
    );
    let browser: Browser | undefined;
    let guest: Guest | undefined;
    try {
      await view.webContents.loadURL('about:blank');
      const endpoint = await this.endpoint();
      browser = await puppeteer.connect({
        ...(endpoint.startsWith('ws:')
          ? { browserWSEndpoint: endpoint }
          : { browserURL: endpoint }),
        defaultViewport: null,
      });
      view.webContents.debugger.attach('1.3');
      const { targetInfo } = await view.webContents.debugger.sendCommand(
        'Target.getTargetInfo',
      );
      view.webContents.debugger.detach();
      const targetPage = await browser.waitForTarget(
        (t) =>
          (t as unknown as { _targetId: string })._targetId ===
          targetInfo.targetId,
        { timeout: 10000 },
      );
      const page = (await targetPage.page()) as NativePage | null;
      if (!page) throw new Error('Cannot attach native browser page');
      guest = {
        view,
        page,
        browser,
        width: target.viewportWidth,
        height: target.viewportHeight,
        stopRecording: async () => {},
        stopPreview: preview.dispose,
        updatePreview: preview.update,
        inputQueue: Promise.resolve(),
      };
      const current = guest;
      let navigationFailed = false;
      view.webContents.on(
        'did-start-navigation',
        (_event, url, inPlace, mainFrame) => {
          if (mainFrame && !inPlace && !url.startsWith('chrome-error:')) {
            navigationFailed = false;
            current.error = undefined;
            current.loadingSince = Date.now();
          }
        },
      );
      view.webContents.on(
        'did-fail-load',
        (_event, code, description, _url, mainFrame) => {
          // Aborted/superseded navigation and iframe failures do not mean the
          // displayed main document failed. Chromium's error document can still
          // emit did-finish-load, so retain this failure until a new navigation.
          if (!mainFrame || code === -3) return;
          navigationFailed = true;
          current.loadingSince = undefined;
          current.error = `网页加载失败（${description}），请检查网络后刷新。`;
          this.place();
        },
      );
      view.webContents.on('render-process-gone', (_event, details) => {
        current.loadingSince = undefined;
        current.error = `网页进程已退出（${details.reason}），请重新连接。`;
        this.place();
      });
      view.webContents.on('did-finish-load', () => {
        current.loadingSince = undefined;
        if (!navigationFailed) current.error = undefined;
        this.place();
      });
      // Slow subresources must not hide an already usable document.
      view.webContents.on('dom-ready', () => {
        resetZoom();
        current.loadingSince = undefined;
      });
      view.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url))
          void view.webContents
            .loadURL(url)
            .catch((error) => debug('Popup navigation failed', error));
        return { action: 'deny' };
      });
      const activate = () => {
        this.active = current;
        this.place();
      };
      const setViewport = async (size: { width: number; height: number }) => {
        if (
          ![size.width, size.height].every(
            (n) => Number.isFinite(n) && n >= 100 && n <= 16384,
          )
        )
          throw new Error('Invalid page size');
        current.width = size.width;
        current.height = size.height;
        view.setContentSize(size.width, size.height);
        await page.waitForFunction(
          (width, height) => innerWidth === width && innerHeight === height,
          { timeout: 5000 },
          size.width,
          size.height,
        );
        this.place();
      };
      page.setViewport = setViewport;
      page.viewport = () => ({ width: current.width, height: current.height });
      let captureQueue: Promise<unknown> = Promise.resolve();
      const captureScreenshot = async () => {
        // DOM changes can precede Chromium's compositor, particularly while
        // minimized. Wait for rendering before copying its surface.
        await page.evaluate(
          () =>
            new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(
                () => reject(new Error('网页画面尚未就绪，请重试。')),
                2000,
              );
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  clearTimeout(timeout);
                  resolve();
                }),
              );
            }),
        );
        // Capture the full-size source surface, independently of the preview.
        const image = await view.webContents.capturePage(undefined, {
          stayHidden: true,
          stayAwake: true,
        });
        // Normalize high-DPI rendering to the page's CSS coordinate space.
        return encodeNativeBrowserScreenshot(image, {
          width: current.width,
          height: current.height,
        });
      };
      page.studioNative = {
        activate,
        setViewport,
        captureScreenshot: () => {
          // An Agent request after an action must not reuse a recorder capture
          // that started before it. Serialize fresh captures instead of sharing one.
          const pending = captureQueue.then(captureScreenshot);
          captureQueue = pending.catch(() => {});
          return pending;
        },
        startRecording: async (listener) => {
          await current.stopRecording();
          const binding = `__studioRecord_${randomUUID().replace(/-/g, '')}`;
          const control = `${binding}_stop`;
          let enabled = true;
          let screenshot: string | undefined;
          let capturing = false;
          const capture = async () => {
            if (
              capturing ||
              !enabled ||
              view.isDestroyed() ||
              view.webContents.isDestroyed()
            )
              return;
            capturing = true;
            try {
              screenshot = await page.studioNative!.captureScreenshot();
            } catch (error) {
              debug('Native recorder frame unavailable', error);
            } finally {
              capturing = false;
            }
          };
          await capture();
          let captureTimer: ReturnType<typeof setInterval> | undefined;
          const delivery = createRecorderDelivery<Packet>(
            async (packet) => {
              if (packet.subframe) {
                // Preserve the action even if its iframe disappears during navigation.
                const frameUrl = packet.url;
                const x = packet.payload.x;
                const y = packet.payload.y;
                packet.url = page.url();
                packet.width = current.width;
                packet.height = current.height;
                packet.nativeTarget = {
                  error: '嵌入页面中的操作需要 Agent 执行。',
                };
                packet.payload.x = undefined;
                packet.payload.y = undefined;
                const frames = page
                  .frames()
                  .filter(
                    (frame) =>
                      frame !== page.mainFrame() && frame.url() === frameUrl,
                  );
                const element =
                  frames.length === 1 ? await frames[0].frameElement() : null;
                const bounds = await element?.boundingBox();
                await element?.dispose();
                if (bounds) {
                  if (typeof x === 'number') packet.payload.x = x + bounds.x;
                  if (typeof y === 'number') packet.payload.y = y + bounds.y;
                }
              }
            },
            listener,
            (error) =>
              debug(
                'Native recorder target unavailable; action retained',
                error,
              ),
          );
          await page.exposeFunction(binding, (packet: Packet) => {
            if (
              !enabled ||
              this.active !== current ||
              !packet?.payload ||
              typeof packet.url !== 'string'
            )
              return;
            packet.screenshot = screenshot;
            return delivery.receive(packet);
          });
          const modulePath = path.join(
            path.dirname(nativeRequire.resolve('@midscene/playground')),
            'recorder-native-playwright.js',
          );
          const { nativeRecorderCaptureSource } = nativeRequire(modulePath) as {
            nativeRecorderCaptureSource: () => string;
          };
          const source = nativeRecorderScript(
            nativeRecorderCaptureSource(),
            binding,
            control,
          );
          const preload = await page.evaluateOnNewDocument(source);
          let stopping: Promise<void> | undefined;
          current.stopRecording = () => {
            if (stopping) return stopping;
            if (!enabled) return Promise.resolve();
            clearInterval(captureTimer);
            stopping = stopRecorderDelivery(
              async () => {
                if (page.isClosed()) return;
                // Remove the preload first so navigation cannot install another recorder.
                await page.removeScriptToEvaluateOnNewDocument(
                  preload.identifier,
                );
                await Promise.all(
                  page
                    .frames()
                    .map((frame) =>
                      frame
                        .evaluate(`window[${JSON.stringify(control)}]?.()`)
                        .catch((error) =>
                          debug('Recorder document closed', error),
                        ),
                    ),
                );
              },
              () => delivery.drain(),
              () => {
                enabled = false;
              },
            ).finally(async () => {
              if (!page.isClosed()) await page.removeExposedFunction(binding);
            });
            return stopping;
          };
          try {
            await Promise.all(
              page.frames().map((frame) => frame.evaluate(source)),
            );
            captureTimer = setInterval(() => void capture(), 250);
          } catch (error) {
            await current.stopRecording();
            throw error;
          }
        },
        stopRecording: () => current.stopRecording(),
      };
      activate();
      let sessionRestore: string | undefined;
      if (profile && existsSync(sessionFile)) {
        const saved = JSON.parse(
          safeStorage.decryptString(await readFile(sessionFile)),
        ) as {
          cookies: CookiesSetDetails[];
          origin: string;
          storage: Record<string, string>;
        };
        for (const cookie of saved.cookies) {
          if (
            !cookie.expirationDate ||
            cookie.expirationDate > Date.now() / 1000
          )
            await guestSession.cookies.set(cookie);
        }
        sessionRestore = (
          await page.evaluateOnNewDocument((state) => {
            if (location.origin === state.origin)
              for (const [key, value] of Object.entries(state.storage))
                sessionStorage.setItem(key, value);
          }, saved)
        ).identifier;
      }
      // Bridge legacy Chromium login data once. Shell configuration/scenarios
      // stay in their existing storage; never point Electron at Chrome's files.
      const migrationMarker = path.join(directory, 'studio-imported.json');
      if (
        profile &&
        migrate &&
        existsSync(path.join(profile, 'Default')) &&
        !existsSync(migrationMarker)
      ) {
        const legacy = await migrate();
        try {
          const oldPage = legacy.page as Page;
          const cookies = await oldPage.browser().cookies();
          await Promise.all(
            cookies.map((cookie) =>
              guestSession.cookies.set({
                url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${cookie.path}`,
                name: cookie.name,
                value: cookie.value,
                ...(cookie.domain.startsWith('.')
                  ? { domain: cookie.domain }
                  : {}),
                path: cookie.path,
                secure: cookie.secure,
                httpOnly: cookie.httpOnly,
                ...(cookie.expires > 0
                  ? { expirationDate: cookie.expires }
                  : {}),
                sameSite:
                  cookie.sameSite === 'Strict'
                    ? 'strict'
                    : cookie.sameSite === 'Lax'
                      ? 'lax'
                      : cookie.sameSite === 'None'
                        ? 'no_restriction'
                        : 'unspecified',
              }),
            ),
          );
          const storage = await oldPage.evaluate(() => ({
            origin: location.origin,
            local: { ...localStorage },
            session: { ...sessionStorage },
          }));
          const restore = await page.evaluateOnNewDocument((saved) => {
            if (location.origin === saved.origin) {
              for (const [key, value] of Object.entries(saved.local))
                localStorage.setItem(key, value);
              for (const [key, value] of Object.entries(saved.session))
                sessionStorage.setItem(key, value);
            }
          }, storage);
          await view.webContents.loadURL(target.url);
          await page.removeScriptToEvaluateOnNewDocument(restore.identifier);
          await mkdir(directory, { recursive: true });
          await writeFile(migrationMarker, JSON.stringify({ version: 1 }));
        } finally {
          for (const cleanup of legacy.freeFn) await cleanup.fn();
        }
      } else await view.webContents.loadURL(target.url);
      if (sessionRestore)
        await page.removeScriptToEvaluateOnNewDocument(sessionRestore);
      return {
        page,
        freeFn: [
          {
            name: 'studio_native_browser',
            fn: async () => {
              await current.stopRecording();
              if (
                profile &&
                !view.isDestroyed() &&
                !view.webContents.isDestroyed()
              ) {
                try {
                  const state = await page.evaluate(() => ({
                    origin: location.origin,
                    storage: { ...sessionStorage },
                  }));
                  const cookies = (await guestSession.cookies.get({})).map(
                    (cookie) => ({
                      ...cookie,
                      domain: cookie.hostOnly ? undefined : cookie.domain,
                      url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain?.replace(/^\./, '')}${cookie.path || '/'}`,
                    }),
                  );
                  await mkdir(directory, { recursive: true });
                  await writeFile(
                    `${sessionFile}.tmp`,
                    safeStorage.encryptString(
                      JSON.stringify({ ...state, cookies }),
                    ),
                  );
                  await rename(`${sessionFile}.tmp`, sessionFile);
                  await guestSession.cookies.flushStore();
                } catch (error) {
                  debug('Could not persist native session', error);
                }
              }
              if (this.active === current) {
                this.active = undefined;
              }
              current.stopPreview();
              win.removeListener('closed', closeWithShell);
              if (!view.isDestroyed()) {
                guestSession.flushStorageData();
                view.destroy();
              }
              await current.browser.disconnect();
            },
          },
        ],
      };
    } catch (error) {
      if (this.active === guest) {
        this.active = previousGuest;
        this.place();
      }
      preview.dispose();
      win.removeListener('closed', closeWithShell);
      if (!view.isDestroyed()) view.destroy();
      await browser?.disconnect();
      throw error;
    }
  }
}
