// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SAVED_WEB_PAGES_KEY,
  loadSavedWebPages,
  normalizeSavedWebPage,
  removeWebPage,
  renameWebPage,
  saveWebPage,
  webPageFormValues,
} from '../src/renderer/playground/saved-web-pages';

beforeEach(() => localStorage.clear());
describe('saved Web pages', () => {
  it('retains a renamed page across reopening and removes only the chosen site', () => {
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
      url: 'https://mom.test/jobs',
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
  it('restores site-specific dimensions, URL and browser mode from storage', () => {
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
    expect(loadSavedWebPages()).toHaveLength(2);
    expect(webPageFormValues(loadSavedWebPages()[0])).toMatchObject({
      'web.url': 'http://mom.test/jobs',
      'web.viewportWidth': 1440,
      platformId: 'web',
    });
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
