// @vitest-environment jsdom
import { setUiLanguage, t } from '@midscene/visualizer/ui-language';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SettingsDock from '../src/renderer/components/SettingsDock';
import SettingsPanel from '../src/renderer/components/SettingsPanel';
import {
  applyStoredLanguage,
  readStoredLanguage,
  setStudioLanguage,
} from '../src/renderer/i18n';
import { ThemeProvider } from '../src/renderer/theme/ThemeProvider';

describe('Studio language selection', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setUiLanguage('en');
  });

  afterEach(() => {
    setUiLanguage('en');
    document.documentElement.lang = 'en';
  });

  it('defaults to Chinese and ignores invalid stored preferences', () => {
    expect(readStoredLanguage()).toBe('zh');
    window.localStorage.setItem('studio.language', 'invalid');
    expect(applyStoredLanguage()).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('restores the selected language without touching model settings', () => {
    window.localStorage.setItem(
      'model-config-fixture',
      'MIDSCENE_MODEL_NAME=gpt-6',
    );
    setStudioLanguage('en');
    setUiLanguage('zh');
    expect(applyStoredLanguage()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem('model-config-fixture')).toBe(
      'MIDSCENE_MODEL_NAME=gpt-6',
    );
    expect(t('MIDSCENE_MODEL_FAMILY')).toBe('MIDSCENE_MODEL_FAMILY');
    expect(t('aiTap')).toBe('aiTap');
  });

  it('switches mounted controls in both directions and persists the choice', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const click = async (label: string) => {
      const button = [...container.querySelectorAll('button')].find((item) =>
        item.textContent?.includes(label),
      );
      expect(button, `button ${label}`).toBeTruthy();
      await act(async () => button?.click());
    };
    try {
      await act(async () => {
        root.render(
          createElement(
            ThemeProvider,
            null,
            createElement(SettingsPanel, {}),
            createElement(SettingsDock, {
              settingsOpen: false,
              onToggleSettings: () => undefined,
            }),
          ),
        );
      });
      await click('Language');
      await click('中文');
      expect(container.textContent).toContain('设置');
      expect(container.textContent).toContain('语言');
      expect(window.localStorage.getItem('studio.language')).toBe('zh');
      expect(t('保存')).toBe('保存');
      await click('语言');
      await click('English');
      expect(container.textContent).toContain('Settings');
      expect(container.textContent).toContain('Language');
      expect(window.localStorage.getItem('studio.language')).toBe('en');
      expect(t('保存')).toBe('Save');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
