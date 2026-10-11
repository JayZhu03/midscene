import {
  type WebSiteIcon,
  normalizeSiteIconUrl,
} from '../../shared/web-site-icon';

// Read the loaded page's icon, including relative paths and <base> URLs.
export const READ_WEB_SITE_ICON = `(() => {
  const icons = Array.from(document.querySelectorAll('link[rel]'));
  const icon = icons.find(link => link.rel.toLowerCase().split(/\\s+/).includes('icon'))
    || icons.find(link => link.rel.toLowerCase() === 'apple-touch-icon');
  return { pageUrl: location.href, iconUrl: icon?.href || new URL('/favicon.ico', location.href).href };
})()`;

export function attachWebSiteIcon(target: {
  navigationState?: () => Promise<{ isLoading: boolean }>;
  evaluateJavaScript?: (script: string) => Promise<unknown>;
}) {
  const readState = target.navigationState?.bind(target);
  const evaluate = target.evaluateJavaScript?.bind(target);
  if (!readState || !evaluate) return;
  let siteIcon: WebSiteIcon | undefined;
  let pending = false;
  let refreshAfter = 0;
  target.navigationState = async () => {
    const state = await readState();
    if (!pending && Date.now() >= refreshAfter) {
      pending = true;
      refreshAfter = Date.now() + 10000;
      // Icon lookup must never hold up the preview's navigation status.
      void evaluate(READ_WEB_SITE_ICON)
        .then((result) => {
          const value = result as Partial<WebSiteIcon> | null;
          const iconUrl = normalizeSiteIconUrl(value?.iconUrl);
          if (typeof value?.pageUrl === 'string' && iconUrl) {
            siteIcon = { pageUrl: value.pageUrl, iconUrl };
          }
        })
        .catch(() => {
          // Navigation can destroy the execution context; retry on the next cycle.
        })
        .finally(() => {
          pending = false;
        });
    }
    return { ...state, ...(siteIcon ? { siteIcon } : {}) };
  };
}
