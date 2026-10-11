// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  READ_WEB_SITE_ICON,
  attachWebSiteIcon,
} from '../src/main/playground/web-site-icon';
import {
  loadSavedWebPages,
  saveWebPage,
  updateWebPageIcon,
} from '../src/renderer/playground/saved-web-pages';
import { normalizeSiteIconUrl } from '../src/shared/web-site-icon';

afterEach(() => {
  document.head.innerHTML = '';
  localStorage.clear();
});

it('reads a custom favicon against the document base URL', () => {
  document.head.innerHTML =
    '<base href="https://mom.test/ant-web/"><link rel="shortcut icon" href="assets/mom.png">';
  const result = new Function(`return ${READ_WEB_SITE_ICON}`)();
  expect(result.iconUrl).toBe('https://mom.test/ant-web/assets/mom.png');
});

it('does not block navigation status or overlap slow icon lookups', async () => {
  let resolveIcon!: (result: unknown) => void;
  const target = {
    navigationState: async () => ({ isLoading: false }),
    evaluateJavaScript: vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveIcon = resolve;
        }),
    ),
  };
  attachWebSiteIcon(target);
  expect(await target.navigationState()).toEqual({ isLoading: false });
  await target.navigationState();
  expect(target.evaluateJavaScript).toHaveBeenCalledTimes(1);
  resolveIcon({
    pageUrl: 'https://mom.test/',
    iconUrl: 'https://mom.test/brand.png',
  });
  await Promise.resolve();
  expect(await target.navigationState()).toMatchObject({
    siteIcon: { iconUrl: 'https://mom.test/brand.png' },
  });
});

it('persists the favicon without changing dimensions, name or site order', () => {
  const page = {
    url: 'https://mom.test/',
    name: 'MOM',
    viewportWidth: 1440,
    viewportHeight: 900,
    headed: false,
  };
  saveWebPage(page);
  saveWebPage({ ...page, url: 'https://other.test/' });
  updateWebPageIcon({
    pageUrl: 'https://mom.test/orders',
    iconUrl: 'https://cdn.test/mom.png',
  });
  expect(loadSavedWebPages()[1]).toEqual({
    ...page,
    iconUrl: 'https://cdn.test/mom.png',
  });
  saveWebPage(page);
  expect(loadSavedWebPages()[0].iconUrl).toBe('https://cdn.test/mom.png');
  updateWebPageIcon({
    pageUrl: 'https://unrelated.test/',
    iconUrl: 'https://cdn.test/other.png',
  });
  expect(loadSavedWebPages()).toHaveLength(2);
  expect(normalizeSiteIconUrl('file:///C:/secret.png')).toBeUndefined();
  expect(normalizeSiteIconUrl('javascript:alert(1)')).toBeUndefined();
});
