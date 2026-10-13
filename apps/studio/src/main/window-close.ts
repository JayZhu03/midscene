import type { BrowserWindow, Dialog } from 'electron';

/** Resolve the renderer's unsaved-work guard for window close, not reload. */
export function registerWindowCloseConfirmation(
  window: BrowserWindow,
  dialog: Pick<Dialog, 'showMessageBoxSync'>,
  onCancelled: () => void,
) {
  let closing = false;
  window.on('close', () => {
    closing = true;
  });
  window.webContents.on('will-prevent-unload', (event) => {
    if (!closing) return;
    closing = false;
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question',
      title: '关闭 Studio',
      message: '有未保存的脚本或进行中的任务，确认关闭？',
      detail: '关闭将放弃未保存内容并结束当前任务，已完成的网页操作不会撤销。',
      buttons: ['继续使用', '放弃并关闭'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    // Electron's preventDefault here allows the original close to proceed.
    if (choice === 1) event.preventDefault();
    else onCancelled();
  });
}
