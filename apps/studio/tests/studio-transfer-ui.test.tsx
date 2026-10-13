// @vitest-environment jsdom
import { ConfigProvider } from 'antd';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStudioTransfer } from '../src/renderer/components/StudioScenarios/useStudioTransfer';
import { setStudioLanguage } from '../src/renderer/i18n';

const io = vi.hoisted(() => ({
  read: vi.fn(),
  import: vi.fn(),
  export: vi.fn(),
  save: vi.fn(),
  imported: vi.fn(),
  duplicate: false,
  existing: [] as Array<{ name: string }>,
}));
vi.mock('../src/renderer/components/StudioScenarios/transfer', () => ({
  readStudioPackage: io.read,
  importStudioPackage: io.import,
  createStudioPackage: io.export,
  importedBefore: () => io.duplicate,
}));
vi.mock('../src/renderer/recorder/export', () => ({
  saveStudioRecorderFile: io.save,
}));
vi.mock('../src/renderer/components/StudioScenarios/storage', () => ({
  loadStudioScenarios: () => io.existing,
}));
vi.mock('../src/renderer/components/StudioScenarios/script-storage', () => ({
  listScenarioScripts: async () => io.existing,
}));
const scenario = {
  id: 's',
  name: 'Orders',
  description: '',
  createdAt: 1,
  updatedAt: 1,
};
function Harness() {
  const transfer = useStudioTransfer(io.imported);
  return (
    <>
      <button type="button" onClick={() => transfer.openImport('scenario')}>
        Open import
      </button>
      <button type="button" onClick={() => transfer.openExport(scenario)}>
        Open export
      </button>
      {transfer.dialog}
    </>
  );
}
let root: Root;
let host: HTMLElement;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
function button(name: string) {
  const result = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.replace(/\s/g, '') === name.replace(/\s/g, ''),
  );
  if (!result) throw new Error(`Missing button ${name}`);
  return result;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
async function choose() {
  const input = document.querySelector('input[type=file]')!;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer }],
  });
  await act(async () =>
    input.dispatchEvent(new Event('change', { bubbles: true })),
  );
}
beforeEach(async () => {
  vi.clearAllMocks();
  io.duplicate = false;
  io.existing = [];
  io.read.mockResolvedValue({
    manifest: {
      name: 'Imported orders',
      description: 'Regression',
      scripts: [{ steps: [1, 2] }],
    },
    fingerprint: 'f',
  });
  io.export.mockResolvedValue(new Uint8Array([1, 2, 3]));
  setStudioLanguage('en');
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <Harness />
      </ConfigProvider>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
it('previews without importing and requires explicit confirmation for a repeated copy', async () => {
  await click('Open import');
  expect(button('Import').disabled).toBe(true);
  io.duplicate = true;
  io.existing = [{ name: 'Imported orders' }];
  await choose();
  expect(document.body.textContent).toContain('Imported orders');
  expect(io.import).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('A copy will be created.');
  await click('Import');
  expect(io.import).toHaveBeenCalledTimes(1);
  expect(io.imported).toHaveBeenCalledTimes(1);
});
it('keeps invalid packages out of storage with a concise error', async () => {
  io.read.mockRejectedValue(new Error('bad zip internal details'));
  await click('Open import');
  await choose();
  expect(document.querySelector('[role=alert]')?.textContent).toBe(
    'Invalid or incomplete Studio package.',
  );
  expect(button('Import').disabled).toBe(true);
  expect(io.import).not.toHaveBeenCalled();
});
it('opens the save dialog directly and defers generation until a destination is chosen', async () => {
  await click('Open export');
  expect(io.export).not.toHaveBeenCalled();
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(io.save).toHaveBeenCalledWith(
    expect.objectContaining({
      defaultFileName: 'orders.scenario.zip',
      encoding: 'base64',
      content: expect.any(Function),
    }),
  );
  expect(await io.save.mock.calls[0][0].content()).toBe('AQID');
  expect(io.import).not.toHaveBeenCalled();
});
it('omits explanatory hints when the scenario does not already exist', async () => {
  await click('Open import');
  expect(document.querySelector('.studio-transfer-note')).toBeNull();
  await choose();
  expect(document.querySelector('.studio-transfer-note')).toBeNull();
});
