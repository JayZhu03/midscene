import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileScenarioScript } from '../src/renderer/components/StudioScenarios/script-model';
import {
  SCENARIO_SCRIPTS_DATABASE,
  getScenarioScript,
  getScenarioScriptAsset,
  listScenarioScripts,
  saveScenarioScript,
} from '../src/renderer/components/StudioScenarios/script-storage';
import { scenarioEvent, scenarioSession } from './fixtures/scenario-script';

const screenshot = 'data:image/png;base64,AQIDBA==';
function scriptWithScreenshot(id = 'script') {
  return compileScenarioScript({
    id,
    scenarioId: 'scenario',
    name: 'Durable script',
    now: 4,
    session: scenarioSession({
      events: [
        scenarioEvent({
          screenshotAsset: {
            id: 'temporary-recorder-asset',
            mimeType: 'image/png',
            bytes: 4,
          },
          screenshotBefore: screenshot,
        }),
      ],
    }),
  });
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('durable scenario script storage', () => {
  it('persists full source and Blob screenshots across module reload and recorder asset removal', async () => {
    const draft = scriptWithScreenshot();
    const loader = vi.fn(async () => screenshot);
    const saved = await saveScenarioScript(draft, loader);
    expect(loader).toHaveBeenCalledWith('temporary-recorder-asset');
    expect(saved.assets).toHaveLength(2);
    expect(saved.sourceSession.events[0].screenshotBefore).toMatch(
      /^scenario-asset:/,
    );
    expect(saved.sourceSession.events[0].screenshotAsset!.id).not.toBe(
      'temporary-recorder-asset',
    );
    expect(saved.steps[0]).toMatchObject({
      sourceEvent: saved.sourceSession.events[0],
    });
    expect(JSON.stringify(saved)).not.toContain('base64,');
    expect(draft.sourceSession.events[0].screenshotBefore).toBe(screenshot);
    vi.resetModules();
    const reloaded = await import(
      '../src/renderer/components/StudioScenarios/script-storage'
    );
    const restored = await reloaded.getScenarioScript(saved.id);
    expect(restored).toEqual(saved);
    expect(await reloaded.listScenarioScripts('scenario')).toEqual([saved]);
    expect(await reloaded.listScenarioScripts('other-scenario')).toEqual([]);
    for (const ref of saved.assets) {
      const blob = await reloaded.getScenarioScriptAsset(ref.id);
      expect(blob).toBeInstanceOf(Blob);
      expect(blob!.type).toBe('image/png');
      expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([
        1, 2, 3, 4,
      ]);
    }
    // The original recorder asset is gone; durable references remain self-contained.
    expect(await reloaded.saveScenarioScript(saved, async () => null)).toEqual(
      saved,
    );
  });

  it('does not evict scripts after the recorder retention threshold', async () => {
    for (let index = 0; index < 25; index += 1) {
      await saveScenarioScript(
        compileScenarioScript({
          id: `script-${index}`,
          scenarioId: 'scenario',
          name: `Script ${index}`,
          now: index,
          session: scenarioSession(),
        }),
      );
    }
    expect(await listScenarioScripts('scenario')).toHaveLength(25);
    expect((await getScenarioScript('script-0'))!.name).toBe('Script 0');
  });

  it('does not fake success when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(
      saveScenarioScript(scriptWithScreenshot(), async () => screenshot),
    ).rejects.toThrow(/storage is unavailable/);
    await expect(listScenarioScripts('scenario')).rejects.toThrow(
      /storage is unavailable/,
    );
  });

  it('rejects missing screenshot assets before storing any script', async () => {
    await expect(
      saveScenarioScript(scriptWithScreenshot(), async () => null),
    ).rejects.toThrow(/screenshot is unavailable/);
    expect(await listScenarioScripts('scenario')).toEqual([]);
    await expect(
      saveScenarioScript(
        scriptWithScreenshot(),
        async () => 'https://example.com/screenshot.png',
      ),
    ).rejects.toThrow(/screenshot data/);
    expect(await getScenarioScript('script')).toBeNull();
  });

  it('waits for transaction completion and atomically rolls back script and screenshots on abort', async () => {
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (this: IDBObjectStore, ...args) {
        const request = originalPut.apply(this, args);
        if (this.name === 'scripts') {
          request.addEventListener('success', () => this.transaction.abort());
        }
        return request;
      });
    await expect(
      saveScenarioScript(scriptWithScreenshot(), async () => screenshot),
    ).rejects.toThrow(/transaction was aborted/);
    put.mockRestore();
    expect(await listScenarioScripts('scenario')).toEqual([]);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(SCENARIO_SCRIPTS_DATABASE, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const assetCount = await new Promise<number>((resolve) => {
      const tx = db.transaction('assets', 'readonly');
      const request = tx.objectStore('assets').count();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    expect(assetCount).toBe(0);
  });

  it('keeps the previous saved version when an update fails after write request success', async () => {
    const initial = await saveScenarioScript(
      compileScenarioScript({
        id: 'stable',
        scenarioId: 'scenario',
        name: 'Original',
        session: scenarioSession(),
      }),
    );
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (this: IDBObjectStore, ...args) {
        const request = originalPut.apply(this, args);
        if (this.name === 'scripts')
          request.addEventListener('success', () => this.transaction.abort());
        return request;
      });
    await expect(
      saveScenarioScript({ ...initial, name: 'New name' }),
    ).rejects.toThrow(/aborted/);
    put.mockRestore();
    expect(await getScenarioScript('stable')).toEqual(initial);
  });

  it('keeps stable script scenario ownership', async () => {
    const initial = await saveScenarioScript(
      compileScenarioScript({
        id: 'stable',
        scenarioId: 'scenario',
        name: 'Original',
        session: scenarioSession(),
      }),
    );
    await expect(
      saveScenarioScript({ ...initial, scenarioId: 'another' }),
    ).rejects.toThrow(/aborted/);
    expect(await getScenarioScript('stable')).toEqual(initial);
  });

  it('rejects corrupt persisted step/source pairing', async () => {
    const initial = await saveScenarioScript(
      compileScenarioScript({
        id: 'stable',
        scenarioId: 'scenario',
        name: 'Original',
        session: scenarioSession(),
      }),
    );
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(SCENARIO_SCRIPTS_DATABASE, 1);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('scripts', 'readwrite');
      tx.objectStore('scripts').put({
        ...initial,
        steps: [
          {
            ...initial.steps[0],
            sourceEvent: scenarioEvent({ hashId: 'wrong-source' }),
          },
        ],
      });
      tx.oncomplete = () => resolve();
    });
    db.close();
    await expect(getScenarioScript('stable')).rejects.toThrow(
      /Invalid scenario script data/,
    );
  });

  it('keeps executable code frozen when resaving an existing script', async () => {
    const script = scriptWithScreenshot();
    script.steps[0].code = '{\n  await page.locator("button").click();\n}';
    const saved = await saveScenarioScript(script, async () => screenshot);
    expect(saved.steps[0].code).toBe(script.steps[0].code);
    expect((await getScenarioScript(saved.id))!.steps[0].code).toBe(
      script.steps[0].code,
    );
  });
});
