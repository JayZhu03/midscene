/** Only the Studio shell may position the native guest. No arbitrary CDP/JS IPC. */
export interface NativeBrowserLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  blocked: boolean;
}

export interface NativeBrowserState {
  available: boolean;
  id?: number;
  width?: number;
  height?: number;
  error?: string;
  loadingSince?: number;
  snapshot?: string;
}

export function validNativeBrowserLayout(
  value: unknown,
): value is NativeBrowserLayout {
  if (!value || typeof value !== 'object') return false;
  const rect = value as NativeBrowserLayout;
  return (
    ['x', 'y', 'width', 'height'].every((key) => {
      const n = rect[key as 'x'];
      return (
        typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 32768
      );
    }) &&
    typeof rect.visible === 'boolean' &&
    typeof rect.blocked === 'boolean'
  );
}
