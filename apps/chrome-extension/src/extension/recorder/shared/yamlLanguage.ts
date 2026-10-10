import { getPreferredLanguage } from '@midscene/shared/env';

export const YAML_LANGUAGE_STORAGE_KEY = 'midscene-yaml-language';

export const YAML_LANGUAGE_SUGGESTIONS = [
  { label: '自动', value: 'auto' },
  { label: '英语', value: 'English' },
  { label: '中文', value: 'Chinese' },
  { label: '日语', value: 'Japanese' },
  { label: '韩语', value: 'Korean' },
  { label: '法语', value: 'French' },
  { label: '西班牙语', value: 'Spanish' },
];

export type YamlLanguagePreference = string;

export const DEFAULT_YAML_LANGUAGE_PREFERENCE: YamlLanguagePreference = 'auto';

export const getStoredYamlLanguagePreference = (
  storage: Pick<Storage, 'getItem'> = localStorage,
): YamlLanguagePreference => {
  try {
    const stored = storage.getItem(YAML_LANGUAGE_STORAGE_KEY);
    if (stored) {
      return stored;
    }
  } catch (error) {
    console.warn('Failed to read YAML language from localStorage:', error);
  }

  return DEFAULT_YAML_LANGUAGE_PREFERENCE;
};

export const persistYamlLanguagePreference = (
  preference: YamlLanguagePreference,
  storage: Pick<Storage, 'setItem'> = localStorage,
) => {
  try {
    storage.setItem(YAML_LANGUAGE_STORAGE_KEY, preference);
  } catch (error) {
    console.warn('Failed to save YAML language to localStorage:', error);
  }
};

export const resolveYamlGenerationLanguage = (
  preference: YamlLanguagePreference,
  preferredLanguage = getPreferredLanguage(),
) => {
  return preference === 'auto' ? preferredLanguage : preference;
};
