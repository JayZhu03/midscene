import { useEffect, useRef, useState } from 'react';
import { assetUrls } from '../../assets';
import type { SavedWebPage } from '../../playground/saved-web-pages';
import { MaskedIcon } from '../MaskedIcon';

const ICON_RETRY_DELAY_MS = 5000;
const MAX_ICON_RETRIES = 2;

export function WebSiteIcon({
  page,
  className = 'size-4 shrink-0',
}: {
  page: Pick<SavedWebPage, 'url' | 'iconUrl'>;
  className?: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const retryCount = useRef(0);
  const candidates = [page.iconUrl, new URL('/favicon.ico', page.url).href];
  const preferredSrc = candidates.find((url): url is string => !!url);

  useEffect(() => {
    setFailed([]);
    retryCount.current = 0;
    const retryOnOnline = () => {
      retryCount.current = 0;
      setFailed((previous) => [...previous]);
    };
    window.addEventListener('online', retryOnOnline);
    return () => window.removeEventListener('online', retryOnOnline);
  }, [page.url, page.iconUrl]);

  useEffect(() => {
    if (
      !preferredSrc ||
      !failed.includes(preferredSrc) ||
      retryCount.current >= MAX_ICON_RETRIES
    )
      return;
    let image: HTMLImageElement | undefined;
    const timer = window.setTimeout(() => {
      // Keep the fallback visible until the preferred icon has loaded again.
      retryCount.current += 1;
      image = new Image();
      image.referrerPolicy = 'no-referrer';
      image.onload = () => {
        setFailed((previous) => previous.filter((url) => url !== preferredSrc));
      };
      image.onerror = () => setFailed((previous) => [...previous]);
      image.src = preferredSrc;
    }, ICON_RETRY_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      if (image) {
        image.onload = null;
        image.onerror = null;
      }
    };
  }, [failed, preferredSrc]);

  const src = candidates.find(
    (url): url is string => !!url && !failed.includes(url),
  );
  if (!src)
    return <MaskedIcon className={className} src={assetUrls.sidebar.web} />;
  return (
    <img
      alt=""
      aria-hidden="true"
      className={`${className} object-contain`}
      src={src}
      referrerPolicy="no-referrer"
      onError={() => setFailed((previous) => [...previous, src])}
    />
  );
}
