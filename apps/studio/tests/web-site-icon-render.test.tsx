// @vitest-environment jsdom
import { act, createElement } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { WebSiteIcon } from '../src/renderer/components/WebSiteIcon';

const page = {
  url: 'https://site.test/app/',
  iconUrl: 'https://site.test/app/brand.png',
};
let container: HTMLDivElement;
let root: Root;
let probes: HTMLImageElement[];
let unmounted: boolean;

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  probes = [];
  vi.stubGlobal(
    'Image',
    vi.fn(() => {
      const image = document.createElement('img');
      probes.push(image);
      return image;
    }),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  unmounted = false;
});

afterEach(async () => {
  if (!unmounted) await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function renderPage(value: { url: string; iconUrl?: string } = page) {
  await act(async () =>
    root.render(createElement(WebSiteIcon, { page: value })),
  );
}

async function dispatch(
  image: HTMLImageElement | null,
  type: 'error' | 'load',
) {
  expect(image).not.toBeNull();
  await act(async () => image?.dispatchEvent(new Event(type)));
}

async function retry() {
  await act(async () => vi.runOnlyPendingTimers());
}

it('recovers a transient favicon failure while keeping the fallback visible', async () => {
  await renderPage();
  await dispatch(container.querySelector('img'), 'error');
  await dispatch(container.querySelector('img'), 'error');
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('span[aria-hidden]')).not.toBeNull();

  await retry();
  expect(probes[0].src).toBe(page.iconUrl);
  expect(container.querySelector('span[aria-hidden]')).not.toBeNull();
  await dispatch(probes[0], 'load');

  expect(container.querySelector('img')?.src).toBe(page.iconUrl);
  expect(container.querySelector('span[aria-hidden]')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it('limits failed retries, retains a working fallback, and retries after reconnecting', async () => {
  await renderPage();
  await dispatch(container.querySelector('img'), 'error');
  const fallback = container.querySelector('img');
  expect(fallback?.src).toBe('https://site.test/favicon.ico');

  for (let attempt = 0; attempt < 2; attempt++) {
    await retry();
    expect(container.querySelector('img')).toBe(fallback);
    expect(fallback?.src).toBe('https://site.test/favicon.ico');
    await dispatch(probes[attempt], 'error');
  }
  await act(async () => vi.advanceTimersByTime(60000));
  expect(probes).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);

  await act(async () => window.dispatchEvent(new Event('online')));
  await retry();
  await dispatch(probes[2], 'load');
  expect(container.querySelector('img')?.src).toBe(page.iconUrl);
});

it('counts probes that load successfully even if the displayed image fails again', async () => {
  await renderPage();
  await dispatch(container.querySelector('img'), 'error');
  for (let attempt = 0; attempt < 2; attempt++) {
    await retry();
    await dispatch(probes[attempt], 'load');
    await dispatch(container.querySelector('img'), 'error');
  }
  await act(async () => vi.advanceTimersByTime(60000));
  expect(probes).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
  expect(container.querySelector('img')?.src).toBe(
    'https://site.test/favicon.ico',
  );
});

it('recovers the default favicon when no custom icon is saved', async () => {
  await renderPage({ url: page.url });
  await dispatch(container.querySelector('img'), 'error');
  expect(container.querySelector('span[aria-hidden]')).not.toBeNull();
  await retry();
  expect(probes[0].src).toBe('https://site.test/favicon.ico');
  await dispatch(probes[0], 'load');
  expect(container.querySelector('img')?.src).toBe(
    'https://site.test/favicon.ico',
  );
});

it('clears old failures and pending retries when the icon or page URL changes', async () => {
  await renderPage();
  await dispatch(container.querySelector('img'), 'error');
  expect(vi.getTimerCount()).toBe(1);
  const updatedPage = { ...page, iconUrl: 'https://cdn.test/new.png' };
  await renderPage(updatedPage);
  expect(container.querySelector('img')?.src).toBe(updatedPage.iconUrl);
  expect(vi.getTimerCount()).toBe(0);

  await dispatch(container.querySelector('img'), 'error');
  await retry();
  const staleProbe = probes[0];
  await renderPage({ ...updatedPage, url: 'https://other.test/' });
  expect(staleProbe.onload).toBeNull();
  expect(staleProbe.onerror).toBeNull();
  expect(container.querySelector('img')?.src).toBe(updatedPage.iconUrl);
  expect(vi.getTimerCount()).toBe(0);
});

it('removes retry timers and network listeners when unmounted', async () => {
  await renderPage();
  await dispatch(container.querySelector('img'), 'error');
  await act(async () => root.unmount());
  unmounted = true;
  await act(async () => window.dispatchEvent(new Event('online')));
  await retry();
  expect(probes).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});
