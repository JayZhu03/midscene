interface StudioSingleInstanceApp {
  isPackaged: boolean;
  quit: () => void;
  requestSingleInstanceLock: () => boolean;
}

interface ActivatableStudioWindow {
  focus: () => void;
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  isVisible: () => boolean;
  restore: () => void;
  show: () => void;
}

interface RevealableStudioApp {
  isHidden: () => boolean;
  show: () => void;
}

export function acquireStudioSingleInstanceLock(
  application: StudioSingleInstanceApp,
): boolean {
  // Source checkouts use the same persistent profile as shortcut launches.
  // They need the same lock as packaged builds to avoid competing LevelDB owners.
  const acquired = application.requestSingleInstanceLock();
  if (!acquired) {
    application.quit();
  }

  return acquired;
}

export function restoreAndFocusStudioWindow(
  window: ActivatableStudioWindow,
  application?: RevealableStudioApp,
): void {
  if (window.isDestroyed()) {
    return;
  }

  if (application?.isHidden()) {
    application.show();
  }
  if (window.isMinimized()) {
    window.restore();
  }
  if (!window.isVisible()) {
    window.show();
  }
  window.focus();
}
