import { randomUUID } from 'node:crypto';
import { getDebug } from '@midscene/shared/logger';
import {
  type NativeImage,
  type WebContents,
  ipcMain,
  sharedTexture,
} from 'electron';
import { IPC_CHANNELS } from '../../shared/electron-contract';

const debug = getDebug('studio:web-preview', { console: true });

/** Keep one current frame and at most one transfer; never queue a video backlog. */
export function attachNativeBrowserPreview(
  source: WebContents,
  shell: WebContents,
  visible: () => boolean,
) {
  type Frame = {
    texture?: Electron.OffscreenSharedTexture;
    bitmap?: NativeImage;
    retain(): void;
    release(): void;
  };
  let disposed = false;
  let needsFrame = false;
  let latest: Frame | undefined;
  let pending:
    | { token: string; texture?: Electron.SharedTextureImported }
    | undefined;
  const release = () => {
    const current = pending;
    pending = undefined;
    current?.texture?.release();
    if (disposed) {
      ipcMain.off(IPC_CHANNELS.nativeBrowserFramePresented, presented);
      shell.removeListener('render-process-gone', rendererGone);
      shell.removeListener('destroyed', rendererGone);
    }
  };
  const update = () => {
    if (disposed || shell.isDestroyed() || !visible() || !latest) return;
    if (pending) {
      needsFrame = true;
      return;
    }
    needsFrame = false;
    const frame = latest;
    let imported: Electron.SharedTextureImported | undefined;
    try {
      const token = randomUUID();
      if (frame.texture) {
        frame.retain();
        try {
          imported = sharedTexture.importSharedTexture({
            textureInfo: frame.texture.textureInfo,
            allReferencesReleased: () => frame.release(),
          });
        } catch (error) {
          frame.release();
          throw error;
        }
        pending = { token, texture: imported };
        shell.send(IPC_CHANNELS.nativeBrowserFrame, {
          id: source.id,
          token,
          transfer: {
            ...imported.subtle.startTransferSharedTexture(),
            id: imported.textureId,
          },
        });
      } else if (frame.bitmap) {
        pending = { token };
        shell.send(IPC_CHANNELS.nativeBrowserFrame, {
          id: source.id,
          token,
          bitmap: frame.bitmap.toDataURL(),
        });
      }
    } catch (error) {
      release();
      if (!disposed && !shell.isDestroyed())
        debug('Preview frame unavailable', error);
    }
  };
  const presented = (
    event: Electron.IpcMainEvent,
    result: {
      token?: string;
      syncToken?: Electron.SharedTextureSyncToken;
      error?: string;
    },
  ) => {
    if (
      event.sender !== shell ||
      event.senderFrame !== shell.mainFrame ||
      !pending ||
      result?.token !== pending.token
    )
      return;
    try {
      if (result.syncToken)
        pending.texture?.subtle.setReleaseSyncToken(result.syncToken);
      if (result.error && !disposed)
        debug('Preview frame unavailable', result.error);
    } finally {
      release();
      if (needsFrame) update();
    }
  };
  const onPaint = (
    event: Electron.Event<Electron.WebContentsPaintEventParams>,
    _dirty: Electron.Rectangle,
    image: NativeImage,
  ) => {
    const texture = event.texture;
    if (disposed || shell.isDestroyed()) {
      texture?.release();
      return;
    }
    if (!texture && (!image || image.isEmpty())) return;
    let references = 1;
    const frame: Frame = {
      texture,
      bitmap: texture ? undefined : image,
      retain: () => {
        references++;
      },
      release: () => {
        if (--references === 0) texture?.release();
      },
    };
    const prior = latest;
    latest = frame;
    prior?.release();
    update();
  };
  // Keep the current frame even while the canvas mounts or a dialog covers it.
  // Static pages may not repaint when invalidated; re-send this keyframe on reveal.
  ipcMain.on(IPC_CHANNELS.nativeBrowserFramePresented, presented);
  source.on('paint', onPaint);
  const dispose = () => {
    disposed = true;
    if (!source.isDestroyed()) source.off('paint', onPaint);
    latest?.release();
    latest = undefined;
    if (shell.isDestroyed() || !pending) release();
  };
  const rendererGone = () => {
    dispose();
    release();
  };
  shell.once('render-process-gone', rendererGone);
  shell.once('destroyed', rendererGone);
  return { update, dispose };
}
