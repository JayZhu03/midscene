export type StudioWorkspaceMode = 'original' | 'workbench';
export type StudioWorkbenchMenu = 'scenarios' | 'execution-records';

export interface StudioWorkspacePreferences {
  mode: StudioWorkspaceMode;
  menu: StudioWorkbenchMenu;
}

export const STUDIO_WORKSPACE_STORAGE_KEY = 'studio.workspace';

export function loadStudioWorkspacePreferences(): StudioWorkspacePreferences {
  const defaults: StudioWorkspacePreferences = {
    mode: 'original',
    menu: 'scenarios',
  };
  try {
    if (typeof window === 'undefined') return defaults;
    const stored = JSON.parse(
      window.localStorage.getItem(STUDIO_WORKSPACE_STORAGE_KEY) || 'null',
    );
    return {
      mode: stored?.mode === 'workbench' ? 'workbench' : 'original',
      menu:
        stored?.menu === 'execution-records'
          ? 'execution-records'
          : 'scenarios',
    };
  } catch {
    return defaults;
  }
}

export function saveStudioWorkspacePreferences(
  preferences: StudioWorkspacePreferences,
): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      STUDIO_WORKSPACE_STORAGE_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    // Switching remains available when renderer storage is unavailable.
  }
}
