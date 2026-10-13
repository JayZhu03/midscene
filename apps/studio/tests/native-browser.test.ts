import { describe, expect, it } from 'vitest';
import { validNativeBrowserLayout } from '../src/shared/native-browser';

describe('native guest IPC boundary', () => {
  const rect = {
    x: 0,
    y: 40,
    width: 960,
    height: 540,
    visible: true,
    blocked: false,
  };
  it('accepts finite shell bounds including a hidden zero-sized anchor', () => {
    expect(validNativeBrowserLayout(rect)).toBe(true);
    expect(
      validNativeBrowserLayout({ ...rect, width: 0, visible: false }),
    ).toBe(true);
  });
  it('rejects malformed and unbounded requests', () => {
    for (const value of [
      null,
      {},
      { ...rect, x: -1 },
      { ...rect, width: Number.NaN },
      { ...rect, height: Number.POSITIVE_INFINITY },
      { ...rect, width: 40000 },
      { ...rect, visible: 1 },
    ])
      expect(validNativeBrowserLayout(value)).toBe(false);
  });
});
