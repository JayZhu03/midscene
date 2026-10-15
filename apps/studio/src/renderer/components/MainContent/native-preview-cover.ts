// Native views sit above DOM portals. Acquire before mounting a known overlay,
// and release after its close animation, so neither transition exposes the guest.
const covers = new Set<symbol>();
const listeners = new Set<() => Promise<void>>();

export const isNativePreviewCovered = () => covers.size > 0;

export function subscribeNativePreviewCover(listener: () => Promise<void>) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function coverNativePreview(): Promise<() => void> {
  const token = Symbol('native-preview-cover');
  covers.add(token);
  const release = () => {
    if (!covers.delete(token)) return;
    for (const listener of listeners) void listener().catch(() => {});
  };
  try {
    await Promise.all(Array.from(listeners, (listener) => listener()));
    return release;
  } catch (error) {
    release();
    throw error;
  }
}
