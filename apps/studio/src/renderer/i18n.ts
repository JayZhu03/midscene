import {
  type UiLanguage,
  getUiLanguage,
  setUiLanguage,
  t,
  useUiLanguage,
} from '@midscene/visualizer/ui-language';

export { t, useUiLanguage as useStudioLanguage };
export type StudioLanguage = UiLanguage;
export const LANGUAGE_STORAGE_KEY = 'studio.language';

export function readStoredLanguage(): StudioLanguage {
  if (typeof window === 'undefined') return 'zh';
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return stored === 'en' || stored === 'zh' ? stored : 'zh';
}

export function setStudioLanguage(next: StudioLanguage) {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
  setUiLanguage(next);
}

export function applyStoredLanguage() {
  const next = readStoredLanguage();
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
  setUiLanguage(next);
  return getUiLanguage();
}
