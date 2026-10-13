import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { nativeRecorderScript } from '../src/main/playground/native-recorder';

describe('native recorder input methods', () => {
  it('does not record IME key notifications, but keeps committed text and Enter', async () => {
    const listeners = new Map<string, (event: object) => void>();
    const packets: any[] = [];
    const window = {
      send: async (packet: unknown) => {
        packets.push(packet);
      },
      addEventListener: (type: string, listener: (event: object) => void) =>
        listeners.set(type, listener),
      removeEventListener: () => {},
    };
    runInNewContext(
      nativeRecorderScript(
        'const fallback = {}; const capture = () => ({locator:{selector:"input"}});',
        'send',
        'stop',
      ),
      {
        window,
        location: { href: 'https://example.test' },
        document: { title: 'Input' },
        innerWidth: 1920,
        innerHeight: 1080,
        setTimeout,
        clearTimeout,
      },
    );
    for (const event of [
      { key: 'Process' },
      { key: 'Unidentified' },
      { key: 'Dead' },
      { key: 'a', keyCode: 229 },
      { key: 'Enter', isComposing: true },
    ])
      listeners.get('keydown')!({ isTrusted: true, ...event });
    expect(packets).toHaveLength(0);
    listeners.get('compositionend')!({
      isTrusted: true,
      target: {
        value: '生产订单',
        getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 20 }),
      },
    });
    listeners.get('keydown')!({ isTrusted: true, key: 'Enter' });
    expect(packets.map((p) => p.payload)).toEqual([
      { actionType: 'Input', mode: 'replace', value: '生产订单', x: 50, y: 10 },
      { actionType: 'KeyboardPress', keyName: 'Enter' },
    ]);
    await (window as any).stop();
  });
});
