import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  isStudioRendererUrl,
  restrictStudioNavigation,
} from '../src/main/window-security';

describe('Studio navigation restrictions', () => {
  it('only trusts the exact renderer document, allowing hash routing', () => {
    const entry = resolve('studio/index.html');
    const entryUrl = pathToFileURL(entry).href;
    expect(isStudioRendererUrl(`${entryUrl}#settings`, entry)).toBe(true);
    for (const url of [
      'https://evil.test',
      pathToFileURL(resolve('studio/other.html')).href,
      `${entryUrl}?other`,
    ]) {
      expect(isStudioRendererUrl(url, entry)).toBe(false);
    }
    expect(
      isStudioRendererUrl(
        'http://127.0.0.1:5173/#settings',
        entry,
        'http://127.0.0.1:5173',
      ),
    ).toBe(true);
    expect(
      isStudioRendererUrl(
        'http://127.0.0.1:5173/other',
        entry,
        'http://127.0.0.1:5173',
      ),
    ).toBe(false);
  });
  it('blocks new windows, untrusted navigation and redirects', () => {
    const contents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
    });
    restrictStudioNavigation(
      contents as any,
      (url) => url === 'file:///studio/index.html',
    );
    expect(contents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({
      action: 'deny',
    });
    for (const name of ['will-navigate', 'will-redirect']) {
      const event = { preventDefault: vi.fn(), url: 'https://evil.test' };
      contents.emit(name, event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      event.preventDefault.mockClear();
      event.url = 'file:///studio/index.html';
      contents.emit(name, event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });
});
