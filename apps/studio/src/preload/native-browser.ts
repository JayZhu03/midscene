import { ipcRenderer, sharedTexture } from 'electron';
import { IPC_CHANNELS } from '../shared/electron-contract';

/** Only the trusted shell receives textures. The tested webpage has no preload. */
export function registerNativeBrowserPreview() {
  ipcRenderer.on(
    IPC_CHANNELS.nativeBrowserFrame,
    (
      _event,
      packet: {
        id: number;
        token: string;
        transfer?: Electron.SharedTextureTransfer;
        bitmap?: string;
      },
    ) => {
      const findCanvas = () =>
        document.querySelector<HTMLCanvasElement>(
          `canvas[data-studio-browser-id="${Number(packet.id)}"]`,
        );
      const draw = (
        image: CanvasImageSource,
        width: number,
        height: number,
      ) => {
        const canvas = findCanvas();
        if (!canvas) return;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        canvas.getContext('2d', { alpha: false })?.drawImage(image, 0, 0);
      };
      const acknowledge = (
        error?: string,
        syncToken?: Electron.SharedTextureSyncToken,
      ) =>
        ipcRenderer.send(IPC_CHANNELS.nativeBrowserFramePresented, {
          token: packet.token,
          syncToken,
          error,
        });
      if (packet.bitmap) {
        if (!findCanvas()) {
          acknowledge();
          return;
        }
        const image = new Image();
        image.onload = () => {
          try {
            draw(image, image.naturalWidth, image.naturalHeight);
            acknowledge();
          } catch (cause) {
            acknowledge(cause instanceof Error ? cause.message : String(cause));
          }
        };
        image.onerror = () => acknowledge('Cannot decode browser preview');
        image.src = packet.bitmap;
        return;
      }
      let imported: Electron.SharedTextureImportedSubtle | undefined;
      let frame:
        | ReturnType<Electron.SharedTextureImportedSubtle['getVideoFrame']>
        | undefined;
      let syncToken: Electron.SharedTextureSyncToken | undefined;
      let error: string | undefined;
      try {
        if (!packet.transfer) throw new Error('Missing browser preview frame');
        imported = sharedTexture.subtle.finishTransferSharedTexture(
          packet.transfer,
        );
        syncToken = imported.getFrameCreationSyncToken();
        frame = imported.getVideoFrame();
        draw(frame, frame.displayWidth, frame.displayHeight);
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      } finally {
        frame?.close();
        const finished = () => acknowledge(error, syncToken);
        if (imported) imported.release(finished);
        else finished();
      }
    },
  );
}
