import { getDebug } from '@midscene/shared/logger';
import { app } from 'electron';

const debug = getDebug('studio:native-browser', { console: true });

export async function nativeBrowserUsesSharedTexture(): Promise<boolean> {
  const ready = () =>
    app.isHardwareAccelerationEnabled() &&
    app.getGPUFeatureStatus().gpu_compositing === 'enabled';
  if (
    app.commandLine.hasSwitch('disable-gpu') ||
    app.commandLine.hasSwitch('disable-gpu-compositing')
  )
    return false;
  if (ready()) return true;

  // Electron's GPU status is not usable until gpu-info-update. In particular,
  // disabled_software during cold startup does not mean acceleration is absent.
  // Readiness is checked again per launch so a timeout never pins later sessions
  // to the bitmap path. Unavailable drivers must still have a bounded fallback.
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (enabled: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearInterval(poll);
      app.off('gpu-info-update', check);
      resolve(enabled);
    };
    const check = () => {
      if (ready()) finish(true);
    };
    const deadline = setTimeout(() => finish(ready()), 1000);
    const poll = setInterval(check, 25);
    app.on('gpu-info-update', check);
    void app.getGPUInfo('basic').then(check, (error) => {
      debug('GPU information unavailable; using bitmap preview', error);
      finish(false);
    });
    check();
  });
}
