import {
  type StudioAgentOptions,
  normalizeStudioAgentOptions,
} from '../../../shared/agent-options';
import { saveStudioPreference } from '../../studio-preferences-backup';

const STORAGE_KEY = 'studio:agent-options';

export function loadAgentOptions(): StudioAgentOptions {
  if (typeof localStorage === 'undefined') {
    return {};
  }

  const value = localStorage.getItem(STORAGE_KEY);
  if (!value) {
    return {};
  }

  try {
    return normalizeStudioAgentOptions(JSON.parse(value));
  } catch {
    return {};
  }
}

export function saveAgentOptions(options: StudioAgentOptions): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  saveStudioPreference(
    STORAGE_KEY,
    JSON.stringify(normalizeStudioAgentOptions(options)),
  );
}
