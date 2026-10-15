import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Agent } from '@midscene/core/agent';
import { launchPuppeteerPage } from '@midscene/web/puppeteer-agent-launcher';
import { expect, it, vi } from 'vitest';
import { prepareStudioWebPlatform } from '../src/main/playground/multi-platform-runtime';
import { launchPersistentWebPage } from '../src/main/playground/web-profile';

class TestAgent {
  interface = {};
  destroy = vi.fn(async () => {});
  constructor(public page: any) {}
}
const PuppeteerAgent = TestAgent as unknown as new (page: unknown) => Agent;

it('uses screenshot observation for native views without reopening the CDP preview stream', async () => {
  const native = {
    activate: vi.fn(),
    setViewport: vi.fn(),
    captureScreenshot: vi.fn(
      async () => 'data:image/png;base64,full-resolution',
    ),
  };
  const page = {
    studioNative: native,
    viewport: () => ({ width: 1920, height: 1080 }),
  };
  const platform = await prepareStudioWebPlatform({
    getAgentOptions: () => ({}),
    loadWebModule: async () => ({
      PuppeteerAgent,
      nativePreview: true,
      launchPuppeteerPage: vi.fn().mockResolvedValue({ page, freeFn: [] }),
    }),
  });
  const manager = platform.sessionManager!;
  try {
    const session = await manager.createSession({
      url: 'https://example.test',
    });
    const agent = await session.agentFactory!();
    expect(native.activate).toHaveBeenCalled();
    expect(await agent.interface.openFrameSource?.()).toBeUndefined();
    expect(agent.interface.openFrameSource).toBeTypeOf('function');
    expect(await agent.interface.screenshotBase64()).toBe(
      'data:image/png;base64,full-resolution',
    );
    expect(native.captureScreenshot).toHaveBeenCalledTimes(1);
  } finally {
    await manager.destroySession!();
  }
});

it('keeps native image dimensions tied to the owning page during execution session switches', async () => {
  const makePage = (width: number, height: number) => ({
    studioNative: {
      activate: vi.fn(),
      setViewport: vi.fn(),
      captureScreenshot: vi.fn(async () => `image-${width}`),
    },
    viewport: () => ({ width, height }),
    evaluate: vi.fn(async () => ({ width, height })),
  });
  const originalPage = makePage(1920, 1080);
  const freshPage = makePage(1200, 800);
  let finishLaunch!: (value: { page: typeof freshPage; freeFn: [] }) => void;
  let launchStarted!: () => void;
  const launching = new Promise<void>((resolve) => {
    launchStarted = resolve;
  });
  const launch = vi
    .fn()
    .mockResolvedValueOnce({ page: originalPage, freeFn: [] })
    .mockImplementationOnce(() => {
      launchStarted();
      return new Promise((resolve) => {
        finishLaunch = resolve;
      });
    });
  const platform = await prepareStudioWebPlatform({
    getAgentOptions: () => ({}),
    loadWebModule: async () => ({
      PuppeteerAgent,
      nativePreview: true,
      launchPuppeteerPage: launch,
    }),
  });
  const manager = platform.sessionManager!;
  try {
    const session = await manager.createSession({
      url: 'https://example.test',
    });
    const original = await session.agentFactory!();
    const switching = manager.switchExecutionSession!('fresh');
    await launching;
    // A previous screenshot request can finish while the replacement is launching.
    const retainedSize = Promise.resolve()
      .then(() => original.interface.size())
      .catch((error) => ({ error: error.message }));
    finishLaunch({ page: freshPage, freeFn: [] });
    const fresh = await switching;
    expect(await retainedSize).toEqual({ width: 1920, height: 1080 });
    expect(await original.interface.size()).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(await fresh.agent!.interface.size()).toEqual({
      width: 1200,
      height: 800,
    });
    expect(await original.interface.screenshotBase64()).toBe('image-1920');
    expect(await fresh.agent!.interface.screenshotBase64()).toBe('image-1200');
  } finally {
    await manager.destroySession!();
  }
});

it('isolates browser storage, keeps preview capture available and restores the original page', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-isolation-test-'));
  const fixture = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>Execution session</title><button>Ready</button>');
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(fixture.address() as { port: number }).port}/`;
  const platform = await prepareStudioWebPlatform({
    profileRoot: root,
    getAgentOptions: () => ({}),
    loadWebModule: async () => ({
      PuppeteerAgent,
      launchPuppeteerPage: (target, preference) =>
        launchPersistentWebPage(launchPuppeteerPage, target, preference),
    }),
  });
  const manager = platform.sessionManager!;
  const pageOf = (agent: unknown) => (agent as TestAgent).page;
  const storage = (page: any) =>
    page.evaluate(() => ({
      cookie: document.cookie,
      local: localStorage.getItem('login'),
      session: sessionStorage.getItem('login'),
    }));
  try {
    const original = await manager.createSession({
      url,
      viewportWidth: 900,
      viewportHeight: 700,
    });
    const originalPage = pageOf(await original.agentFactory!());
    await originalPage.evaluate(() => {
      document.cookie = 'login=original; path=/';
      localStorage.setItem('login', 'original');
      sessionStorage.setItem('login', 'original');
    });
    await originalPage.setViewport({ width: 1100, height: 800 });
    const first = await manager.switchExecutionSession!('fresh');
    const freshPage = pageOf(first.agent);
    expect(await storage(freshPage)).toEqual({
      cookie: '',
      local: null,
      session: null,
    });
    expect(freshPage.viewport()).toMatchObject({ width: 1100, height: 800 });
    expect(first.preview?.kind).toBe('mjpeg');
    expect((await freshPage.screenshot()).length).toBeGreaterThan(0);
    await freshPage.evaluate(() => {
      localStorage.setItem('login', 'fresh');
    });
    const recreated = pageOf(await first.agentFactory!());
    expect(recreated).toBe(freshPage);
    expect((await storage(recreated)).local).toBe('fresh');
    const second = await manager.switchExecutionSession!('fresh');
    expect(await storage(pageOf(second.agent))).toEqual({
      cookie: '',
      local: null,
      session: null,
    });
    expect(freshPage.isClosed()).toBe(true);
    expect(originalPage.isClosed()).toBe(false);
    const restored = await manager.switchExecutionSession!('restore');
    expect(pageOf(restored.agent)).toBe(originalPage);
    expect(await storage(originalPage)).toEqual({
      cookie: 'login=original',
      local: 'original',
      session: 'original',
    });
    expect(restored.metadata?.executionSession).toBe('current');
    expect(pageOf(second.agent).isClosed()).toBe(true);
  } finally {
    await manager.destroySession!();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

it('preserves the current browser after launch failure and inherits headed mode', async () => {
  const page = { viewport: () => ({ width: 1200, height: 800 }) };
  const close = vi.fn();
  const launch = vi
    .fn()
    .mockResolvedValue({ page, freeFn: [{ name: 'browser', fn: close }] });
  const platform = await prepareStudioWebPlatform({
    getAgentOptions: () => ({}),
    loadWebModule: async () => ({
      PuppeteerAgent,
      launchPuppeteerPage: launch,
    }),
  });
  const manager = platform.sessionManager!;
  const original = await manager.createSession({
    url: 'https://example.test',
    headed: true,
  });
  await original.agentFactory!();
  launch.mockRejectedValueOnce(new Error('Launch failed'));
  await expect(manager.switchExecutionSession!('fresh')).rejects.toThrow(
    'Launch failed',
  );
  expect(close).not.toHaveBeenCalled();
  expect(((await original.agentFactory!()) as unknown as TestAgent).page).toBe(
    page,
  );
  expect(launch.mock.calls[1][1]).toEqual({ headed: true });
  expect(launch.mock.calls[1][0]).toMatchObject({
    viewportWidth: 1200,
    viewportHeight: 800,
  });
  await manager.destroySession!();
  expect(close).toHaveBeenCalledTimes(1);
});
