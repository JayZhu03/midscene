// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { compileScenarioScript } from '../src/renderer/components/StudioScenarios/script-model';
import {
  getScenarioScript,
  getScenarioScriptAsset,
  listScenarioScripts,
  saveScenarioScript,
} from '../src/renderer/components/StudioScenarios/script-storage';
import {
  deleteStudioScenario,
  loadStudioScenarios,
  saveStudioScenarios,
} from '../src/renderer/components/StudioScenarios/storage';
import {
  flushStudioPreferences,
  initializeStudioPreferences,
  saveStudioPreference,
} from '../src/renderer/studio-preferences-backup';
import { scenarioEvent, scenarioSession } from './fixtures/scenario-script';

const screenshot = 'data:image/png;base64,AQIDBA==';
const scenario = (id: string) => ({
  id,
  name: id,
  description: '',
  createdAt: 1,
  updatedAt: 1,
});
async function saveScript(id: string, scenarioId: string) {
  return saveScenarioScript(
    compileScenarioScript({
      id,
      scenarioId,
      name: id,
      session: scenarioSession({
        events: [scenarioEvent({ screenshotBefore: screenshot })],
      }),
    }),
  );
}

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('Blob', NodeBlob);
  localStorage.clear();
  await initializeStudioPreferences();
  saveStudioScenarios([scenario('deleted'), scenario('kept')]);
  saveStudioPreference('studio.scenario-sequence.v1.deleted', '[{"id":"a"}]');
  saveStudioPreference('studio.scenario-session.v1.deleted', 'fresh');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await flushStudioPreferences();
  vi.unstubAllGlobals();
});

it('deletes all owned scripts and screenshots, preserves other data, and does not restore deleted settings from backup', async () => {
  const first = await saveScript('first', 'deleted');
  const second = await saveScript('second', 'deleted');
  const kept = await saveScript('other', 'kept');
  saveStudioPreference('studio.scenario-session.v1.kept', 'reuse');
  saveStudioPreference('studio.webPages.v1', '[{"url":"http://mom.test"}]');
  saveStudioPreference('studio:model-env-text', 'test-only');
  expect(await deleteStudioScenario('deleted')).toEqual([scenario('kept')]);
  expect(await listScenarioScripts('deleted')).toEqual([]);
  for (const script of [first, second]) {
    expect(await getScenarioScript(script.id)).toBeNull();
    for (const asset of script.assets)
      expect(await getScenarioScriptAsset(asset.id)).toBeNull();
  }
  expect(await getScenarioScript(kept.id)).toEqual(kept);
  for (const asset of kept.assets)
    expect(await getScenarioScriptAsset(asset.id)).not.toBeNull();
  await flushStudioPreferences();
  localStorage.clear();
  await initializeStudioPreferences();
  expect(loadStudioScenarios()).toEqual([scenario('kept')]);
  expect(
    localStorage.getItem('studio.scenario-sequence.v1.deleted'),
  ).toBeNull();
  expect(localStorage.getItem('studio.scenario-session.v1.deleted')).toBeNull();
  expect(localStorage.getItem('studio.scenario-session.v1.kept')).toBe('reuse');
  expect(localStorage.getItem('studio.webPages.v1')).toContain('mom.test');
  expect(localStorage.getItem('studio:model-env-text')).toBe('test-only');
});

it('rolls back script and screenshot deletion when saving the list fails', async () => {
  const script = await saveScript('first', 'deleted');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError');
  });
  await expect(deleteStudioScenario('deleted')).rejects.toThrow(
    'Local storage is full',
  );
  expect(loadStudioScenarios()).toEqual([
    scenario('deleted'),
    scenario('kept'),
  ]);
  expect(await getScenarioScript(script.id)).toEqual(script);
  for (const asset of script.assets)
    expect(await getScenarioScriptAsset(asset.id)).not.toBeNull();
});

it('restores the list and settings if IndexedDB aborts after metadata is written', async () => {
  const script = await saveScript('first', 'deleted');
  let deletion: IDBTransaction | undefined;
  const originalDelete = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (this.name === 'assets') deletion = this.transaction;
    return originalDelete.call(this, key);
  });
  const originalRemove = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
    this: Storage,
    key,
  ) {
    originalRemove.call(this, key);
    if (key === 'studio.scenario-session.v1.deleted') deletion!.abort();
  });
  await expect(deleteStudioScenario('deleted')).rejects.toThrow(/aborted/);
  expect(loadStudioScenarios()).toEqual([
    scenario('deleted'),
    scenario('kept'),
  ]);
  expect(await getScenarioScript(script.id)).toEqual(script);
  for (const asset of script.assets)
    expect(await getScenarioScriptAsset(asset.id)).not.toBeNull();
  await flushStudioPreferences();
  localStorage.clear();
  await initializeStudioPreferences();
  expect(loadStudioScenarios()).toEqual([
    scenario('deleted'),
    scenario('kept'),
  ]);
  expect(localStorage.getItem('studio.scenario-sequence.v1.deleted')).toContain(
    '"a"',
  );
  expect(localStorage.getItem('studio.scenario-session.v1.deleted')).toBe(
    'fresh',
  );
});

it('keeps the scenario visible when script storage is unavailable', async () => {
  vi.stubGlobal('indexedDB', undefined);
  await expect(deleteStudioScenario('deleted')).rejects.toThrow(/unavailable/);
  expect(loadStudioScenarios()).toEqual([
    scenario('deleted'),
    scenario('kept'),
  ]);
});
