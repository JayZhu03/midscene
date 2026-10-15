import type { NativeImage } from 'electron';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';
import { encodeNativeBrowserScreenshot } from '../src/main/playground/native-browser-screenshot';

function imageFixture(bitmap = Buffer.from([0, 0, 255, 255, 255, 0, 0, 255])) {
  const normalized = {
    getSize: () => ({ width: 2, height: 1 }),
    toBitmap: () => bitmap,
  };
  const resize = vi.fn(() => normalized);
  const image = { isEmpty: () => false, resize } as unknown as NativeImage;
  return { image, resize };
}

it('preserves lossless screenshot dimensions and red/blue pixel channels', async () => {
  const { image, resize } = imageFixture();
  const dataUrl = await encodeNativeBrowserScreenshot(image, {
    width: 2,
    height: 1,
  });
  const result = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64'))
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(resize).toHaveBeenCalledWith({ width: 2, height: 1, quality: 'good' });
  expect(result.info).toMatchObject({ width: 2, height: 1, channels: 4 });
  expect([...result.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
});

it('rejects empty or incomplete captures instead of returning a blank image', async () => {
  const { image } = imageFixture(Buffer.alloc(1));
  await expect(
    encodeNativeBrowserScreenshot(image, { width: 2, height: 1 }),
  ).rejects.toThrow('截图数据不完整');
  await expect(
    encodeNativeBrowserScreenshot({ isEmpty: () => true } as NativeImage, {
      width: 2,
      height: 1,
    }),
  ).rejects.toThrow('截图为空');
});
