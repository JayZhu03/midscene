import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeRecorderScript } from '../src/main/playground/native-recorder';

afterEach(() => vi.useRealTimers());
function harness(throwCapture = false) {
  vi.useFakeTimers();
  const listeners = new Map<string, (event: any) => void>();
  const packets: any[] = [];
  class Element {
    value = '';
    isContentEditable = false;
    matches() {
      return false;
    }
    getBoundingClientRect() {
      return { x: 0, y: 0, width: 100, height: 20 };
    }
  }
  const window: any = {
    send: async (packet: unknown) => {
      packets.push(packet);
    },
    addEventListener: (type: string, listener: (event: any) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  window.top = window;
  runInNewContext(
    nativeRecorderScript(
      `const fallback={};const capture=()=>{${throwCapture ? 'throw new Error("detached")' : 'return {locator:{selector:"input"}}'}};`,
      'send',
      'stop',
    ),
    {
      window,
      Element,
      location: { href: 'https://example.test' },
      document: { title: 'Test' },
      innerWidth: 1920,
      innerHeight: 1080,
      setTimeout,
      clearTimeout,
      Date,
    },
  );
  const event = (type: string, target: object, overrides = {}) =>
    listeners.get(type)?.({
      isTrusted: true,
      target,
      composedPath: () => [target],
      clientX: 50,
      clientY: 10,
      button: 0,
      detail: 1,
      ...overrides,
    });
  return { packets, window, event, Element };
}

describe('native recorder input methods', () => {
  it('keeps every rapid click including detail=2 and detail=3 with target identity', async () => {
    const h = harness();
    const first = new h.Element();
    const second = new h.Element();
    for (const [target, detail] of [
      [first, 1],
      [second, 2],
      [second, 3],
    ] as const) {
      h.event('pointerdown', target);
      h.event('pointerup', target);
      h.event('click', target, { detail });
    }
    await h.window.stop();
    expect(h.packets.map((p) => p.payload.actionType)).toEqual([
      'Tap',
      'Tap',
      'Tap',
    ]);
    expect(h.packets[0].clickTarget).not.toBe(h.packets[1].clickTarget);
    expect(h.packets[1].clickTarget).toBe(h.packets[2].clickTarget);
    expect(h.packets.map((p) => p.clickCount)).toEqual([1, 2, 3]);
  });
  it('flushes separate inputs before focus switches, clicks, navigation and stop', async () => {
    const h = harness();
    const first = new h.Element();
    const second = new h.Element();
    first.value = '订单A';
    second.value = '订单B';
    h.event('input', first);
    h.event('input', second);
    h.event('click', second);
    first.value = '订单C';
    h.event('input', first);
    h.event('pagehide', first);
    second.value = '订单D';
    h.event('input', second);
    await h.window.stop();
    expect(
      h.packets.map((p) => p.payload.value || p.payload.actionType),
    ).toEqual(['订单A', '订单B', 'Tap', '订单C', '订单D']);
    await vi.runAllTimersAsync();
    expect(h.packets).toHaveLength(5);
  });
  it('retains the action for Agent recovery when DOM capture throws', async () => {
    const h = harness(true);
    const el = new h.Element();
    h.event('pointerdown', el);
    h.event('pointerup', el);
    h.event('click', el);
    el.value = 'value';
    h.event('input', el);
    await h.window.stop();
    expect(h.packets.map((p) => p.payload.actionType)).toEqual([
      'Tap',
      'Input',
    ]);
    expect(h.packets.every((p) => p.nativeTarget.error.includes('Agent'))).toBe(
      true,
    );
  });
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
