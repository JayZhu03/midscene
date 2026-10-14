import type { MenuProps } from 'antd';
import { t } from '../../i18n';
import { saveStudioPreference } from '../../studio-preferences-backup';

export type SessionMode = 'current' | 'fresh';
const key = (scenarioId: string) => `studio.scenario-session.v1.${scenarioId}`;
export function loadSessionMode(scenarioId: string): SessionMode {
  return localStorage.getItem(key(scenarioId)) === 'fresh'
    ? 'fresh'
    : 'current';
}
export function saveSessionMode(scenarioId: string, mode: SessionMode) {
  saveStudioPreference(key(scenarioId), mode);
}
export function sessionModeMenu(
  mode: SessionMode,
  disabled = false,
  android = false,
): NonNullable<MenuProps['items']>[number] {
  return {
    key: 'session-mode',
    label: t(
      mode === 'fresh'
        ? android
          ? 'Restart application then run'
          : 'Fresh session'
        : 'Use current session',
    ),
    disabled,
    children: [
      { key: 'session-current', label: t('Use current session') },
      {
        key: 'session-fresh',
        label: t(android ? 'Restart application then run' : 'Fresh session'),
      },
    ],
  };
}
