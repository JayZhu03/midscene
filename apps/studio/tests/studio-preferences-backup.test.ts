// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
});

test('restores scenario, webpage and model settings after localStorage disappears', async () => {
  const storage = await import('../src/renderer/studio-preferences-backup');
  localStorage.setItem('studio.scenarios.v1', '[{"id":"scene"}]');
  localStorage.setItem('studio.webPages.v1', '[{"url":"http://mom.test"}]');
  localStorage.setItem('unrelated', 'do not back up');
  await storage.initializeStudioPreferences();
  storage.saveStudioPreference(
    'studio:model-env-text',
    'MIDSCENE_MODEL_API_KEY=test-only',
  );
  await storage.flushStudioPreferences();
  localStorage.clear();
  await storage.initializeStudioPreferences();
  expect(localStorage.getItem('studio.scenarios.v1')).toBe('[{"id":"scene"}]');
  expect(localStorage.getItem('studio.webPages.v1')).toContain('mom.test');
  expect(localStorage.getItem('studio:model-env-text')).toContain('test-only');
  expect(localStorage.getItem('unrelated')).toBeNull();
});

test('preserves newer local values and mirrors deliberate empty lists and cleared model config', async () => {
  const storage = await import('../src/renderer/studio-preferences-backup');
  localStorage.setItem('studio.scenarios.v1', '[{"id":"old"}]');
  await storage.initializeStudioPreferences();
  localStorage.setItem('studio.scenarios.v1', '[{"id":"new"}]');
  await storage.initializeStudioPreferences();
  expect(localStorage.getItem('studio.scenarios.v1')).toContain('new');
  storage.saveStudioPreference('studio.scenarios.v1', '[]');
  storage.saveStudioPreference('studio:model-env-text', '');
  await storage.flushStudioPreferences();
  localStorage.clear();
  await storage.initializeStudioPreferences();
  expect(localStorage.getItem('studio.scenarios.v1')).toBe('[]');
  expect(localStorage.getItem('studio:model-env-text')).toBe('');
});

test('writes preferences in order so the latest change is restored', async () => {
  const storage = await import('../src/renderer/studio-preferences-backup');
  await storage.initializeStudioPreferences();
  storage.saveStudioPreference('studio.scenario-sequence.v1.s', 'first');
  storage.saveStudioPreference('studio.scenario-sequence.v1.s', 'latest');
  await storage.flushStudioPreferences();
  localStorage.clear();
  await storage.initializeStudioPreferences();
  expect(localStorage.getItem('studio.scenario-sequence.v1.s')).toBe('latest');
});
