export interface WebSiteIcon {
  pageUrl: string;
  iconUrl: string;
}

export function normalizeSiteIconUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 131072) return undefined;
  if (
    /^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml);/i.test(
      value,
    )
  )
    return value;
  try {
    const url = new URL(value);
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* Invalid icons fall back to the browser glyph. */
  }
  return undefined;
}
