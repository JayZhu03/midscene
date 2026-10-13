import { useEffect, useState } from 'react';

export const CONNECTION_DELAY_MS = 10000;
export const CONNECTION_DELAY_MESSAGE =
  'Connection is taking longer than expected. Check your network or retry.';

/** A hint, not a timeout: keep the connection attempt alive. */
export function useConnectionDelay(since: number | undefined) {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    setDelayed(false);
    if (since === undefined) return;
    const timer = setTimeout(
      () => setDelayed(true),
      Math.max(0, since + CONNECTION_DELAY_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [since]);
  return since !== undefined && delayed;
}
