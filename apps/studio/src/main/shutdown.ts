interface StudioShutdownApp {
  on(
    event: 'will-quit',
    listener: (event: { preventDefault(): void }) => void,
  ): void;
  quit(): void;
}

/** Run only after close guards accept quitting; never leave an invisible owner
 * of the single-instance/profile lock waiting forever for browser or HTTP work. */
export function registerStudioShutdown(
  application: StudioShutdownApp,
  closeRuntime: () => Promise<void>,
  onError: (error: unknown) => void,
) {
  let started = false;
  let finished = false;
  application.on('will-quit', (event) => {
    if (finished) return;
    event.preventDefault();
    if (started) return;
    started = true;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      // Keep Electron's normal shutdown so Chromium flushes its local profile.
      application.quit();
    };
    const deadline = setTimeout(() => {
      onError(new Error('Studio runtime cleanup timed out after 5000ms.'));
      finish();
    }, 5000);
    void Promise.resolve().then(closeRuntime).catch(onError).finally(finish);
  });
}
