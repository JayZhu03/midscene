import { useSyncExternalStore } from 'react';
import { UI_MESSAGES } from './ui-messages';

export type UiLanguage = 'zh' | 'en';

// Keep the extension's Chinese default. Embedding apps can select a language
// before mounting their React tree, without changing model or runtime settings.
let language: UiLanguage = 'zh';
const listeners = new Set<() => void>();
const englishMessages = new Map(
  Object.entries(UI_MESSAGES).map(([english, chinese]) => [chinese, english]),
);

export function setUiLanguage(next: UiLanguage) {
  if (next === language) return;
  language = next;
  for (const listener of listeners) listener();
}

export function getUiLanguage() {
  return language;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUiLanguage() {
  return useSyncExternalStore(subscribe, getUiLanguage, getUiLanguage);
}

/** Translate UI copy only; unknown text, API identifiers and user data pass through. */
export function t(text: string, params?: Record<string, string | number>) {
  const english = englishMessages.get(text) ?? text;
  const translated =
    language === 'zh' ? (UI_MESSAGES[english] ?? text) : english;
  if (!params) return translated;
  return translated.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(params, key) ? String(params[key]) : match,
  );
}
