import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentStepInstruction,
  compileScenarioScript,
  createAgentStep,
  editScenarioScript,
} from '../src/renderer/components/StudioScenarios/script-model';
import {
  getScenarioScriptAsset,
  listScenarioScripts,
  saveScenarioScript,
} from '../src/renderer/components/StudioScenarios/script-storage';
import {
  loadSequence,
  saveSequence,
} from '../src/renderer/components/StudioScenarios/sequence';
import {
  loadSessionMode,
  saveSessionMode,
} from '../src/renderer/components/StudioScenarios/session-mode';
import {
  loadStudioScenarios,
  saveStudioScenarios,
} from '../src/renderer/components/StudioScenarios/storage';
import {
  createStudioPackage,
  importName,
  importStudioPackage,
  importedBefore,
  readStudioPackage,
} from '../src/renderer/components/StudioScenarios/transfer';
import { scenarioEvent, scenarioSession } from './fixtures/scenario-script';

const scenario = {
  id: 'scenario',
  name: '订单测试',
  description: '生产与制造',
  createdAt: 1,
  updatedAt: 1,
};
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage });
  saveStudioScenarios([scenario]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function saved(id = 'script') {
  const compiled = compileScenarioScript({
    id,
    scenarioId: scenario.id,
    name: '生产订单',
    now: 5,
    session: scenarioSession({
      events: [
        scenarioEvent({ screenshotBefore: 'data:image/png;base64,AQIDBA==' }),
      ],
      checkpoints: [
        {
          id: 'checkpoint',
          instruction: '总数是 2165',
          timestamp: 2,
          afterEventHashIds: ['event-1'],
        },
      ],
    }),
  });
  const operation = agentStepInstruction(
    createAgentStep('agent-operation'),
    '展开生产订单',
  );
  return saveScenarioScript(
    editScenarioScript(compiled, [
      compiled.steps[0],
      operation,
      agentStepInstruction(compiled.steps[1], '总数是 2155'),
    ]),
  );
}
async function rewrite(
  bytes: Uint8Array,
  fn: (zip: JSZip, manifest: any) => void,
) {
  const zip = await JSZip.loadAsync(bytes);
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  fn(zip, manifest);
  zip.file('manifest.json', JSON.stringify(manifest));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('Studio transfer', () => {
  it('preserves password inputs in code, reading notes and imported copies', async () => {
    const value = 'test-password-"quoted"\\value';
    const original = await saveScenarioScript(
      compileScenarioScript({
        scenarioId: scenario.id,
        name: 'Login',
        session: scenarioSession({
          events: [
            scenarioEvent({
              type: 'input',
              actionType: 'Input',
              value,
              nativeTarget: {
                locator: { selector: 'input[type="password"]' },
                editable: true,
                sensitive: true,
              },
            }),
          ],
        }),
      }),
    );
    const bytes = await createStudioPackage(scenario, original);
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('README.md')!.async('string')).toContain(
      JSON.stringify(value),
    );
    const bundle = await readStudioPackage(bytes, 'script');
    expect(bundle.manifest.scripts[0].steps[0].code).toContain(
      `fill(${JSON.stringify(value)})`,
    );
    expect(bundle.manifest.scripts[0].steps[0].code).not.toContain(
      'MIDSCENE_INPUT',
    );
    await importStudioPackage(bundle, scenario);
    const copy = (await listScenarioScripts(scenario.id)).find(
      (s) => s.id !== original.id,
    )!;
    expect(copy.sourceSession.events[0].value).toBe(value);
    expect(copy.steps[0].code).toBe(original.steps[0].code);
  });
  it('roundtrips edited mixed steps, original recording and screenshots without overwriting', async () => {
    const original = await saved();
    const bytes = await createStudioPackage(scenario, original);
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('README.md')!.async('string')).toContain('2155');
    const bundle = await readStudioPackage(bytes, 'script');
    expect(importedBefore(bundle.fingerprint)).toBe(false);
    await importStudioPackage(bundle, scenario);
    expect(importedBefore(bundle.fingerprint)).toBe(true);
    const scripts = await listScenarioScripts(scenario.id);
    const copy = scripts.find((s) => s.id !== original.id)!;
    expect(copy.name).toBe('生产订单（导入）');
    expect(copy.steps.map((s) => s.code)).toEqual(
      original.steps.map((s) => s.code),
    );
    expect(copy.recordedSteps!.map((s) => s.code)).toEqual(
      original.recordedSteps!.map((s) => s.code),
    );
    expect(copy.steps.map((s) => s.id)).not.toEqual(
      original.steps.map((s) => s.id),
    );
    expect(copy.assets[0].id).not.toBe(original.assets[0].id);
    expect(
      Array.from(
        new Uint8Array(
          await (await getScenarioScriptAsset(
            copy.assets[0].id,
          ))!.arrayBuffer(),
        ),
      ),
    ).toEqual([1, 2, 3, 4]);
    expect(scripts.find((s) => s.id === original.id)).toEqual(original);
    expect(loadSequence(scenario.id, scripts).at(-1)).toEqual({
      id: copy.id,
      startMode: 'manual',
    });
    await importStudioPackage(bundle, scenario);
    expect(
      (await listScenarioScripts(scenario.id)).map((s) => s.name),
    ).toContain('生产订单（导入 2）');
  });

  it('preserves scenario order and session settings with new IDs in a new scenario', async () => {
    const a = await saved('a');
    const b = await saved('b');
    saveSequence(scenario.id, [
      { id: b.id, startMode: 'automatic' },
      { id: a.id, startMode: 'manual' },
    ]);
    saveSessionMode(scenario.id, 'fresh');
    const bundle = await readStudioPackage(
      await createStudioPackage(scenario),
      'scenario',
    );
    const copy = await importStudioPackage(bundle);
    expect(copy.id).not.toBe(scenario.id);
    expect(copy.name).toBe('订单测试（导入）');
    expect(copy.description).toBe(scenario.description);
    const scripts = await listScenarioScripts(copy.id);
    const order = loadSequence(copy.id, scripts);
    expect(order.map((e) => e.startMode)).toEqual(['automatic', 'manual']);
    expect(scripts.find((s) => s.id === order[0].id)!.name).toBe(
      '生产订单（导入）',
    );
    expect(loadSessionMode(copy.id)).toBe('fresh');
    expect(loadStudioScenarios()).toHaveLength(2);
  });

  it('supports an empty scenario', async () => {
    const bundle = await readStudioPackage(
      await createStudioPackage(scenario),
      'scenario',
    );
    const copy = await importStudioPackage(bundle);
    expect(await listScenarioScripts(copy.id)).toEqual([]);
  });

  it('rejects wrong type, unknown versions, missing screenshots and unsafe paths', async () => {
    const original = await saved();
    const bytes = await createStudioPackage(scenario, original);
    await expect(readStudioPackage(bytes, 'scenario')).rejects.toThrow(
      'correct type',
    );
    await expect(
      readStudioPackage(
        await rewrite(bytes, (_, m) => {
          m.version = 99;
        }),
        'script',
      ),
    ).rejects.toThrow('version');
    await expect(
      readStudioPackage(
        await rewrite(bytes, (zip) => {
          zip.remove('assets/0-0.png');
        }),
        'script',
      ),
    ).rejects.toThrow('incomplete');
    await expect(
      readStudioPackage(
        await rewrite(bytes, (zip) => {
          zip.file('../outside', 'bad');
        }),
        'script',
      ),
    ).rejects.toThrow('incomplete');
    await expect(
      readStudioPackage(
        await rewrite(bytes, (_, m) => {
          m.sequence = [];
        }),
        'script',
      ),
    ).rejects.toThrow('incomplete');
    expect(await listScenarioScripts(scenario.id)).toHaveLength(1);
  });

  it('rejects decompression bombs before extraction', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', 'a'.repeat(21 * 1024 * 1024));
    const bytes = await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
    });
    await expect(readStudioPackage(bytes, 'scenario')).rejects.toThrow(
      'too large',
    );
  });

  it('rejects screenshot corruption even when its byte length is unchanged', async () => {
    const original = await saved();
    const zip = await JSZip.loadAsync(
      await createStudioPackage(scenario, original),
    );
    const bytes = await zip.generateAsync({
      type: 'uint8array',
      compression: 'STORE',
    });
    const offset = bytes.findIndex(
      (v, i) =>
        v === 1 &&
        bytes[i + 1] === 2 &&
        bytes[i + 2] === 3 &&
        bytes[i + 3] === 4,
    );
    expect(offset).toBeGreaterThan(0);
    bytes[offset + 2] = 9;
    await expect(readStudioPackage(bytes, 'script')).rejects.toThrow(
      'incomplete',
    );
  });

  it('rolls back scripts and metadata if local storage refuses the import', async () => {
    await saved();
    const bundle = await readStudioPackage(
      await createStudioPackage(scenario),
      'scenario',
    );
    const before = loadStudioScenarios();
    const set = localStorage.setItem.bind(localStorage);
    let writes = 0;
    vi.spyOn(localStorage, 'setItem').mockImplementation((k, v) => {
      if (++writes === 2) throw new Error('quota');
      set(k, v);
    });
    await expect(importStudioPackage(bundle)).rejects.toThrow('quota');
    expect(loadStudioScenarios()).toEqual(before);
    expect(importedBefore(bundle.fingerprint)).toBe(false);
    expect(await listScenarioScripts(scenario.id)).toHaveLength(1);
  });

  it('does not publish metadata on IndexedDB failure', async () => {
    await saved();
    const bundle = await readStudioPackage(
      await createStudioPackage(scenario),
      'scenario',
    );
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(() => {
      throw new Error('write failed');
    });
    await expect(importStudioPackage(bundle)).rejects.toThrow();
    expect(loadStudioScenarios()).toHaveLength(1);
    expect(importedBefore(bundle.fingerprint)).toBe(false);
  });

  it('bounds names and refuses missing destination scenarios', async () => {
    const long = 'a'.repeat(80);
    expect(importName(long, [long])).toHaveLength(80);
    const original = await saved();
    const bundle = await readStudioPackage(
      await createStudioPackage(scenario, original),
      'script',
    );
    saveStudioScenarios([]);
    await expect(importStudioPackage(bundle, scenario)).rejects.toThrow(
      'no longer exists',
    );
  });
});
