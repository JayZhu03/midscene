import { getDebug } from '@midscene/shared/logger';
import { type WebSiteIcon, normalizeSiteIconUrl } from '@shared/web-site-icon';
import { DEFAULT_STUDIO_WEB_VIEWPORT } from '@shared/web-viewport';
import { useEffect, useState } from 'react';
import { saveStudioPreference } from '../studio-preferences-backup';

export interface SavedWebPage {
  iconUrl?: string;
  name?: string;
  url: string;
  viewportWidth: number;
  viewportHeight: number;
  headed: boolean;
}

export const SAVED_WEB_PAGES_KEY = 'studio.webPages.v1';

function findSavedPage(url: URL, pages: SavedWebPage[]) {
  const exact = pages.find((page) => new URL(page.url).href === url.href);
  if (exact) return exact;
  // Navigation may leave the saved entry URL. Only use the site as a fallback
  // when it identifies one entry, never an arbitrary sibling route.
  const sameSite = pages.filter(
    (page) => new URL(page.url).origin === url.origin,
  );
  return sameSite.length === 1 ? sameSite[0] : undefined;
}

export function savedWebPageDisplay(url: unknown, pages: SavedWebPage[]) {
  if (typeof url !== 'string') return undefined;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    const saved = findSavedPage(parsed, pages);
    return {
      name: saved?.name || parsed.host,
      url: parsed.href,
      iconUrl: saved?.iconUrl,
    };
  } catch {
    return undefined;
  }
}

const changedEvent = 'studio:web-pages-changed';
const debug = getDebug('studio:web-pages', { console: true });

export function normalizeSavedWebPage(value: unknown): SavedWebPage | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<SavedWebPage>;
  if (typeof input.url !== 'string' || !input.url.trim()) return null;
  let url: URL;
  try {
    const raw = input.url.trim();
    url = new URL(raw.includes('://') ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    return null;
  }
  const dimension = (size: unknown, fallback: number) =>
    typeof size === 'number' &&
    Number.isFinite(size) &&
    size >= 100 &&
    size <= 8192
      ? Math.round(size)
      : fallback;
  return {
    ...(normalizeSiteIconUrl(input.iconUrl)
      ? { iconUrl: normalizeSiteIconUrl(input.iconUrl) }
      : {}),
    ...(typeof input.name === 'string' && input.name.trim()
      ? { name: input.name.trim().slice(0, 80) }
      : {}),
    url: url.href,
    viewportWidth: dimension(
      input.viewportWidth,
      DEFAULT_STUDIO_WEB_VIEWPORT.width,
    ),
    viewportHeight: dimension(
      input.viewportHeight,
      DEFAULT_STUDIO_WEB_VIEWPORT.height,
    ),
    headed: input.headed === true,
  };
}

export function loadSavedWebPages(): SavedWebPage[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(SAVED_WEB_PAGES_KEY) || '[]',
    );
    return Array.isArray(stored)
      ? stored
          .map(normalizeSavedWebPage)
          .filter((page): page is SavedWebPage => page !== null)
      : [];
  } catch (error) {
    debug('Unable to read saved pages: %s', error);
    return [];
  }
}

export function saveWebPage(input: SavedWebPage) {
  const page = normalizeSavedWebPage(input);
  if (!page) throw new Error('Please enter a valid HTTP or HTTPS URL.');
  // Explicitly opened URLs are separate entries, including query/hash routes.
  // Ordinary in-page navigation does not call this function.
  const previous = loadSavedWebPages();
  const saved = previous.find((item) => item.url === page.url);
  const pages = [
    {
      ...page,
      ...(saved?.name ? { name: saved.name } : {}),
      ...(saved?.iconUrl ? { iconUrl: saved.iconUrl } : {}),
    },
    ...previous.filter((item) => item.url !== page.url),
  ];
  saveStudioPreference(SAVED_WEB_PAGES_KEY, JSON.stringify(pages));
  window.dispatchEvent(new Event(changedEvent));
}

export function renameWebPage(url: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Please enter a page name.');
  const href = new URL(url).href;
  const pages = loadSavedWebPages().map((page) =>
    page.url === href ? { ...page, name: trimmed.slice(0, 80) } : page,
  );
  saveStudioPreference(SAVED_WEB_PAGES_KEY, JSON.stringify(pages));
  window.dispatchEvent(new Event(changedEvent));
}

export function updateWebPageIcon(value: WebSiteIcon, entryUrl?: string) {
  const iconUrl = normalizeSiteIconUrl(value?.iconUrl);
  if (!iconUrl) return;
  let url: URL;
  try {
    url = new URL(value.pageUrl);
  } catch {
    return;
  }
  const pages = loadSavedWebPages();
  const entry = entryUrl
    ? pages.find((item) => item.url === entryUrl)
    : undefined;
  const page = entry
    ? new URL(entry.url).origin === url.origin
      ? entry
      : undefined
    : findSavedPage(url, pages);
  if (!page || page.iconUrl === iconUrl) return;
  page.iconUrl = iconUrl;
  saveStudioPreference(SAVED_WEB_PAGES_KEY, JSON.stringify(pages));
  window.dispatchEvent(new Event(changedEvent));
}

export function removeWebPage(url: string) {
  const href = new URL(url).href;
  const pages = loadSavedWebPages().filter((page) => page.url !== href);
  saveStudioPreference(SAVED_WEB_PAGES_KEY, JSON.stringify(pages));
  window.dispatchEvent(new Event(changedEvent));
}

export function webPageFormValues(page?: SavedWebPage) {
  return {
    platformId: 'web',
    ...(page
      ? {
          'web.url': page.url,
          'web.viewportWidth': page.viewportWidth,
          'web.viewportHeight': page.viewportHeight,
          'web.headed': false,
        }
      : {}),
  };
}

export function useSavedWebPages() {
  const [pages, setPages] = useState(loadSavedWebPages);
  useEffect(() => {
    const update = () => setPages(loadSavedWebPages());
    window.addEventListener(changedEvent, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(changedEvent, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return pages;
}
