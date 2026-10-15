import { describe, expect, it } from 'vitest';
import {
  validNativeBrowserInput,
  validNativeBrowserLayout,
} from '../src/shared/native-browser';

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

describe('browser input IPC boundary', () => {
  const pointer = {
    id: 12,
    type: 'mouseDown',
    x: 1919,
    y: 1079,
    button: 'left',
    clickCount: 1,
    modifiers: [],
  };
  it('accepts page coordinates, text and the supported editing shortcuts', () => {
    expect(validNativeBrowserInput(pointer)).toBe(true);
    expect(
      validNativeBrowserInput({ id: 12, type: 'insertText', text: '生产订单' }),
    ).toBe(true);
    expect(
      validNativeBrowserInput({ id: 12, type: 'shortcut', action: 'paste' }),
    ).toBe(true);
  });
  it('rejects invalid targets, unsupported actions and unbounded data', () => {
    for (const input of [
      null,
      {},
      { ...pointer, id: 0 },
      { ...pointer, x: Number.NaN },
      { ...pointer, y: Number.POSITIVE_INFINITY },
      { ...pointer, clickCount: -1 },
      { ...pointer, button: 'unknown' },
      { ...pointer, modifiers: ['unsupported'] },
      { id: 12, type: 'shortcut', action: 'executeJavaScript' },
      { id: 12, type: 'insertText', text: 'x'.repeat(65537) },
      { ...pointer, type: 'mouseWheel', deltaX: 0, deltaY: Number.NaN },
    ])
      expect(validNativeBrowserInput(input)).toBe(false);
  });
});
