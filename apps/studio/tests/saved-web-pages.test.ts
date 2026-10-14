// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SAVED_WEB_PAGES_KEY,
  loadSavedWebPages,
  normalizeSavedWebPage,
  removeWebPage,
  renameWebPage,
  saveWebPage,
  savedWebPageDisplay,
  updateWebPageIcon,
  webPageFormValues,
} from '../src/renderer/playground/saved-web-pages';

beforeEach(() => localStorage.clear());
describe('saved Web pages', () => {
  it('retains a renamed page across reopening and removes only the chosen page', () => {
    const first = {
      url: 'https://mom.test/orders',
      viewportWidth: 1920,
      viewportHeight: 1080,
      headed: false,
    };
    saveWebPage(first);
    saveWebPage({ ...first, url: 'https://second.test/' });
    renameWebPage(first.url, '  MOM 测试环境  ');
    expect(() => renameWebPage(first.url, '  ')).toThrow();
    saveWebPage({
      ...first,
      url: first.url,
      viewportWidth: 1440,
    });
    expect(loadSavedWebPages()[0]).toMatchObject({
      name: 'MOM 测试环境',
      viewportWidth: 1440,
    });
    removeWebPage(first.url);
    expect(loadSavedWebPages().map((page) => page.url)).toEqual([
      'https://second.test/',
    ]);
  });
  it('restores page-specific dimensions, URL and browser mode from storage', () => {
    const first = {
      url: 'http://mom.test/orders',
      viewportWidth: 1440,
      viewportHeight: 900,
      headed: false,
    };
    saveWebPage(first);
    saveWebPage({
      ...first,
      url: 'https://second.test/',
      viewportWidth: 1280,
      headed: true,
    });
    expect(loadSavedWebPages()[1]).toEqual(first);
    saveWebPage({ ...first, url: 'http://mom.test/jobs' });
    expect(loadSavedWebPages()).toHaveLength(3);
    expect(webPageFormValues(loadSavedWebPages()[0])).toMatchObject({
      'web.url': 'http://mom.test/jobs',
      'web.viewportWidth': 1440,
      platformId: 'web',
    });
  });
  it('keeps hash routes and query routes independent through rename, reopen and delete', () => {
    const base = {
      url: 'https://mom.test/ant-web/#/admin',
      viewportWidth: 1920,
      viewportHeight: 1080,
      headed: false,
    };
    const workbench = {
      ...base,
      url: 'https://mom.test/ant-web/#/workbench',
      viewportWidth: 1440,
      headed: true,
    };
    saveWebPage(base);
    saveWebPage(workbench);
    renameWebPage(base.url, '管理系统');
    renameWebPage(workbench.url, '工作台');
    saveWebPage(base);
    expect(loadSavedWebPages()).toEqual([
      { ...base, name: '管理系统' },
      { ...workbench, name: '工作台' },
    ]);
    expect(savedWebPageDisplay(workbench.url, loadSavedWebPages())?.name).toBe(
      '工作台',
    );
    updateWebPageIcon({
      pageUrl: workbench.url,
      iconUrl: 'https://mom.test/workbench.ico',
    });
    expect(loadSavedWebPages()[0].iconUrl).toBeUndefined();
    expect(loadSavedWebPages()[1].iconUrl).toBe(
      'https://mom.test/workbench.ico',
    );
    // A navigated child page updates only the session's saved entry.
    updateWebPageIcon(
      {
        pageUrl: 'https://mom.test/ant-web/#/orders',
        iconUrl: 'https://mom.test/admin.ico',
      },
      base.url,
    );
    expect(loadSavedWebPages()[0].iconUrl).toBe('https://mom.test/admin.ico');
    expect(loadSavedWebPages()[1].iconUrl).toBe(
      'https://mom.test/workbench.ico',
    );
    removeWebPage(base.url);
    expect(loadSavedWebPages()).toHaveLength(1);
    expect(loadSavedWebPages()[0].name).toBe('工作台');
    saveWebPage({ ...base, url: 'https://mom.test/?page=admin' });
    saveWebPage({ ...base, url: 'https://mom.test/?page=workbench' });
    expect(loadSavedWebPages()).toHaveLength(3);
  });
  it('deduplicates equivalent normalized URLs', () => {
    const page = normalizeSavedWebPage({ url: 'mom.test' })!;
    saveWebPage(page);
    saveWebPage({ ...page, url: 'http://mom.test:80/' });
    expect(loadSavedWebPages()).toHaveLength(1);
  });
  it('rejects invalid URLs and credentials, tolerates corrupt saved data', () => {
    expect(normalizeSavedWebPage({ url: 'javascript://alert(1)' })).toBeNull();
    expect(
      normalizeSavedWebPage({ url: 'https://user:secret@mom.test' }),
    ).toBeNull();
    localStorage.setItem(SAVED_WEB_PAGES_KEY, '{broken');
    expect(loadSavedWebPages()).toEqual([]);
    localStorage.setItem(
      SAVED_WEB_PAGES_KEY,
      '[null, {"url":"http://mom.test", "viewportWidth": -1}]',
    );
    expect(loadSavedWebPages()[0]).toMatchObject({
      viewportWidth: 1920,
      viewportHeight: 1080,
    });
  });
});
