// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STUDIO_WORKSPACE_STORAGE_KEY,
  loadStudioWorkspacePreferences,
  saveStudioWorkspacePreferences,
} from '../src/renderer/components/StudioWorkspace/preferences';

describe('Studio workspace preferences', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('defaults to the original workspace and scenarios menu', () => {
    expect(loadStudioWorkspacePreferences()).toEqual({
      mode: 'original',
      menu: 'scenarios',
    });
  });

  it('restores the mode and menu across renderer sessions', () => {
    saveStudioWorkspacePreferences({
      mode: 'workbench',
      menu: 'execution-records',
    });
    expect(loadStudioWorkspacePreferences()).toEqual({
      mode: 'workbench',
      menu: 'execution-records',
    });
  });

  it.each(['{invalid', 'null', '{"mode":"unknown","menu":"unknown"}'])(
    'recovers from invalid stored preferences: %s',
    (stored) => {
      localStorage.setItem(STUDIO_WORKSPACE_STORAGE_KEY, stored);
      expect(loadStudioWorkspacePreferences()).toEqual({
        mode: 'original',
        menu: 'scenarios',
      });
    },
  );

  it('tolerates unavailable renderer storage for reads and writes', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage full');
    });
    expect(loadStudioWorkspacePreferences().mode).toBe('original');
    expect(() =>
      saveStudioWorkspacePreferences({ mode: 'workbench', menu: 'scenarios' }),
    ).not.toThrow();
  });
});
