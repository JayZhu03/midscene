import { useState } from 'react';
import { assetUrls } from '../../assets';
import type { SavedWebPage } from '../../playground/saved-web-pages';
import { MaskedIcon } from '../MaskedIcon';

export function WebSiteIcon({
  page,
  className = 'size-4 shrink-0',
}: {
  page: Pick<SavedWebPage, 'url' | 'iconUrl'>;
  className?: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const candidates = [page.iconUrl, new URL('/favicon.ico', page.url).href];
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
