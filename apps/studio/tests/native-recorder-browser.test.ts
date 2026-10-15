import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { nativeRecorderScript } from '../src/main/playground/native-recorder';
import {
  createRecorderDelivery,
  stopRecorderDelivery,
} from '../src/main/playground/native-recorder-delivery';

let browser: Browser;
beforeAll(async () => {
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => {
  await browser?.close();
});
async function setup(html: string) {
  const page = await browser.newPage();
  await page.setContent(html);
  const packets: any[] = [];
  const errors: unknown[] = [];
  let enabled = true;
  const delivery = createRecorderDelivery<any>(
    async () => {},
    (packet) => packets.push(packet),
    (error) => errors.push(error),
  );
  await page.exposeFunction('record', (packet: any) => {
    if (enabled) return delivery.receive(packet);
  });
  const require = createRequire(import.meta.url);
  const { nativeRecorderCaptureSource } = require(
    join(
      dirname(require.resolve('@midscene/playground')),
      'recorder-native-playwright.js',
    ),
  );
  await page.evaluate(
    nativeRecorderScript(nativeRecorderCaptureSource(), 'record', 'stopRecord'),
  );
  const stop = () =>
    stopRecorderDelivery(
      async () => {
        await page.evaluate('window.stopRecord()');
      },
      () => delivery.drain(),
      () => {
        enabled = false;
      },
    );
  return { page, packets, errors, stop };
}

it('captures real browser typing immediately followed by stop with the native locator', async () => {
  const h = await setup(
    '<input id="order" placeholder="订单号"><button>保存</button>',
  );
  try {
    await h.page.focus('#order');
    await h.page.keyboard.type('ORDER-123');
    await h.stop();
    const inputs = h.packets.filter((p) => p.payload.actionType === 'Input');
    expect(inputs.at(-1).payload.value).toBe('ORDER-123');
    expect(inputs.at(-1).nativeTarget.locator).toBeTruthy();
    expect(h.errors).toEqual([]);
  } finally {
    await h.page.close();
  }
});

it.each([
  ['input', '<input id="entry">'],
  ['textarea', '<textarea id="entry"></textarea>'],
  ['contenteditable', '<div id="entry" contenteditable="true"></div>'],
])(
  'records mixed-case text without a separate Caps Lock action (%s)',
  async (_type, html) => {
    const h = await setup(`${html}<button id="save">保存</button>`);
    try {
      await h.page.focus('#entry');
      await h.page.keyboard.type('s');
      await h.page.keyboard.press('CapsLock');
      await h.page.keyboard.down('Shift');
      await h.page.keyboard.press('KeyU');
      await h.page.keyboard.up('Shift');
      await h.page.keyboard.type('PER');
      await h.page.keyboard.press('CapsLock');
      await h.page.click('#save');
      await h.stop();
      expect(
        h.packets.filter((p) => p.payload.actionType === 'KeyboardPress'),
      ).toEqual([]);
      const inputs = h.packets.filter((p) => p.payload.actionType === 'Input');
      expect(inputs.at(-1).payload.value).toBe('sUPER');
      expect(inputs.every((p) => p.nativeTarget.locator)).toBe(true);
      expect(h.packets.at(-1).payload.actionType).toBe('Tap');
      expect(h.errors).toEqual([]);
    } finally {
      await h.page.close();
    }
  },
);

it('retains rapid actions when React-like rendering replaces the clicked button', async () => {
  const h = await setup(
    '<button id="next" onclick="this.outerHTML=\'<button id=confirm>确认</button>\'">下一步</button>',
  );
  try {
    const box = await h.page.$eval('#next', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + 5, y: r.y + 5 };
    });
    await h.page.mouse.click(box.x, box.y, { count: 1 });
    await h.page.mouse.down({ clickCount: 2 });
    await h.page.mouse.up({ clickCount: 2 });
    await h.stop();
    expect(h.packets.map((p) => p.payload.actionType)).toEqual(['Tap', 'Tap']);
    expect(h.packets[0].clickTarget).not.toBe(h.packets[1].clickTarget);
    expect(h.packets.every((p) => p.nativeTarget.locator)).toBe(true);
  } finally {
    await h.page.close();
  }
});

it('preserves an actual double click as one operation without an extra tap', async () => {
  const h = await setup('<button id="edit">编辑订单</button>');
  try {
    await h.page.click('#edit', { count: 2 });
    await h.stop();
    expect(h.packets.map((p) => p.payload.actionType)).toEqual(['DoubleClick']);
  } finally {
    await h.page.close();
  }
});

it.each(['remove', 'hide', 'stay'])(
  'records Ant Select clear on mousedown exactly once (%s)',
  async (behavior) => {
    const h = await setup(
      `<div class="ant-select"><span>所属工厂</span><span class="ant-select-clear" style="display:inline-block;width:16px;height:16px" onmousedown="event.preventDefault();event.stopPropagation();document.body.dataset.cleared='yes';${behavior === 'remove' ? 'this.remove()' : behavior === 'hide' ? "this.style.display='none'" : ''}"><svg width="16" height="16"><path d="M2 2L14 14M2 14L14 2" stroke="black" /></svg></span></div>`,
    );
    try {
      await h.page.click('.ant-select-clear');
      expect(await h.page.evaluate(() => document.body.dataset.cleared)).toBe(
        'yes',
      );
      await h.stop();
      expect(h.packets).toHaveLength(1);
      expect(h.packets[0].payload.actionType).toBe('Tap');
      expect(JSON.stringify(h.packets[0].nativeTarget.locator)).toContain(
        'ant-select-clear',
      );
    } finally {
      await h.page.close();
    }
  },
);
