// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { attachNativeBrowserInput } from '../src/renderer/components/MainContent/native-browser-input';
import type { NativeBrowserInput } from '../src/shared/native-browser';

afterEach(() => document.body.replaceChildren());

function setup() {
  const canvas = document.createElement('canvas');
  const text = document.createElement('textarea');
  document.body.append(canvas, text);
  const send = vi.fn(async (_input: NativeBrowserInput) => {});
  let blocked = false;
  const dispose = attachNativeBrowserInput(canvas, text, {
    id: 5,
    width: 1920,
    height: 1080,
    send,
    blocked: () => blocked,
    onError: vi.fn(),
  });
  return {
    canvas,
    text,
    send,
    dispose,
    block: () => {
      blocked = true;
    },
  };
}

it('commits Chinese composition once and forwards subsequent text independently', () => {
  const { text, send, dispose } = setup();
  try {
    text.dispatchEvent(new CompositionEvent('compositionstart'));
    for (const value of ['中', '中文']) {
      text.value = value;
      text.dispatchEvent(new InputEvent('input', { isComposing: true }));
    }
    expect(send).not.toHaveBeenCalled();
    text.dispatchEvent(
      new CompositionEvent('compositionend', { data: '中文' }),
    );
    text.dispatchEvent(new InputEvent('input', { data: '中文' }));
    text.value = 'A';
    text.dispatchEvent(new InputEvent('input', { data: 'A' }));
    expect(send.mock.calls.map(([input]) => input)).toEqual([
      { id: 5, type: 'insertText', text: '中文' },
      { id: 5, type: 'insertText', text: 'A' },
    ]);
  } finally {
    dispose();
  }
});

it('stops forwarding when blocked or detached, including old focused textareas', () => {
  const { text, send, block, dispose } = setup();
  text.value = 'before';
  text.dispatchEvent(new InputEvent('input'));
  expect(send).toHaveBeenCalledTimes(1);
  block();
  text.value = 'during';
  text.dispatchEvent(new InputEvent('input'));
  dispose();
  text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  text.value = 'after';
  text.dispatchEvent(new InputEvent('input'));
  expect(send).toHaveBeenCalledTimes(1);
});
