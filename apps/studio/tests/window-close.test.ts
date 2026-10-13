import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerWindowCloseConfirmation } from '../src/main/window-close';

function setup() {
  const window = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(),
  });
  const dialog = { showMessageBoxSync: vi.fn(() => 0) };
  const cancelled = vi.fn();
  registerWindowCloseConfirmation(
    window as unknown as BrowserWindow,
    dialog,
    cancelled,
  );
  return { window, dialog, cancelled };
}

describe('unsaved work close confirmation', () => {
  it('keeps reload guarded and closes clean work without a prompt', () => {
    const { window, dialog } = setup();
    const event = { preventDefault: vi.fn() };
    window.webContents.emit('will-prevent-unload', event);
    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    window.emit('close');
    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
  });

  it('preserves work on cancel and can subsequently confirm another close', () => {
    const { window, dialog, cancelled } = setup();
    const event = { preventDefault: vi.fn() };
    window.emit('close');
    window.webContents.emit('will-prevent-unload', event);
    expect(dialog.showMessageBoxSync).toHaveBeenCalledWith(
      window,
      expect.objectContaining({ defaultId: 0, cancelId: 0 }),
    );
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledOnce();
    // Cancelling a close must not bypass a later reload guard.
    window.webContents.emit('will-prevent-unload', event);
    expect(dialog.showMessageBoxSync).toHaveBeenCalledTimes(1);
    dialog.showMessageBoxSync.mockReturnValue(1);
    window.emit('close');
    window.webContents.emit('will-prevent-unload', event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
