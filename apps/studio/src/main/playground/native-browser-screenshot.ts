import type { NativeImage } from 'electron';
import sharp from 'sharp';

/** Keep Chromium's resize quality; encode PNGs off the input/preview thread. */
export async function encodeNativeBrowserScreenshot(
  image: NativeImage,
  viewport: { width: number; height: number },
): Promise<string> {
  if (image.isEmpty()) throw new Error('原生浏览器截图为空，请重试。');
  const normalized = image.resize({ ...viewport, quality: 'good' });
  const { width, height } = normalized.getSize(1);
  const bitmap = normalized.toBitmap({ scaleFactor: 1 });
  if (!width || !height || bitmap.length !== width * height * 4)
    throw new Error('原生浏览器截图数据不完整，请重试。');
  // Chromium's native bitmap is BGRA. Sharp accepts RGBA; swap the channels
  // in its worker pool instead of synchronously compressing on Electron's main
  // thread. These browser windows render an opaque surface, including dialogs.
  const png = await sharp(bitmap, {
    raw: { width, height, channels: 4, premultiplied: true },
  })
    .recomb([
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
    ])
    .png({ compressionLevel: 1 })
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}
