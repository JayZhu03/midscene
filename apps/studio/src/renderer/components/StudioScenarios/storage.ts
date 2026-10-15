import { getDebug } from '@midscene/shared/logger';
import {
  removeStudioPreference,
  saveStudioPreference,
} from '../../studio-preferences-backup';
import { deleteScenarioScripts } from './script-storage';

export interface StudioScenario {
  platformId?: 'web' | 'android';
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export const SCENARIOS_STORAGE_KEY = 'studio.scenarios.v1';
export const SCENARIO_NAME_MAX_LENGTH = 80;
export const SCENARIO_DESCRIPTION_MAX_LENGTH = 500;
const debug = getDebug('studio:scenarios', { console: true });

function validateScenarios(value: unknown): StudioScenario[] {
  if (!Array.isArray(value)) throw new Error('Invalid scenario storage.');
  const ids = new Set<string>();
  return value.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      item.id.length > 128 ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      item.name.length > SCENARIO_NAME_MAX_LENGTH ||
      typeof item.description !== 'string' ||
      (item.platformId !== undefined &&
        !['web', 'android'].includes(item.platformId)) ||
      item.description.length > SCENARIO_DESCRIPTION_MAX_LENGTH ||
      !Number.isSafeInteger(item.createdAt) ||
      item.createdAt < 0 ||
      !Number.isSafeInteger(item.updatedAt) ||
      item.updatedAt < item.createdAt
    ) {
      throw new Error('Invalid scenario storage.');
    }
    ids.add(item.id);
    return {
      id: item.id,
      ...(item.platformId ? { platformId: item.platformId } : {}),
      name: item.name.trim(),
      description: item.description.trim(),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });
}

export function loadStudioScenarios(): StudioScenario[] {
  if (typeof window === 'undefined') return [];
  try {
    return validateScenarios(
      JSON.parse(window.localStorage.getItem(SCENARIOS_STORAGE_KEY) || '[]'),
    );
  } catch {
    debug('Unable to read local scenarios; using an empty list.');
    return [];
  }
}

export function saveStudioScenarios(scenarios: StudioScenario[]): void {
  const validated = validateScenarios(scenarios);
  try {
    if (typeof window === 'undefined') throw new Error('Storage unavailable');
    saveStudioPreference(SCENARIOS_STORAGE_KEY, JSON.stringify(validated));
  } catch (error) {
    const errorName =
      error && typeof error === 'object' && 'name' in error ? error.name : '';
    throw new Error(
      errorName === 'QuotaExceededError'
        ? 'Local storage is full. Unable to save.'
        : errorName === 'SecurityError'
          ? 'Local storage is unavailable. Unable to save.'
          : 'Unable to save scenarios locally. Please retry.',
    );
  }
}

export async function deleteStudioScenario(
  id: string,
): Promise<StudioScenario[]> {
  const previous = loadStudioScenarios();
  const next = previous.filter((scenario) => scenario.id !== id);
  const keys = [
    `studio.scenario-sequence.v1.${id}`,
    `studio.scenario-session.v1.${id}`,
  ];
  const settings = keys.map((key) => [key, localStorage.getItem(key)] as const);
  let metadataChanged = false;
  try {
    await deleteScenarioScripts(id, () => {
      saveStudioScenarios(next);
      metadataChanged = true;
      for (const key of keys) removeStudioPreference(key);
    });
    return next;
  } catch (error) {
    // IndexedDB and localStorage cannot share a transaction. Restore metadata
    // if the script/asset transaction aborts after the list was written.
    if (metadataChanged) {
      saveStudioScenarios(previous);
      for (const [key, value] of settings) {
        if (value === null) removeStudioPreference(key);
        else saveStudioPreference(key, value);
      }
    }
    throw error;
  }
}
