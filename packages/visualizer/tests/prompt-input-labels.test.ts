import { afterEach, beforeEach, describe, expect, test } from '@rstest/core';
import { setUiLanguage, t } from '../src/ui-language';
import { getPromptInputActionLabel } from '../src/utils/action-label';

describe('getPromptInputActionLabel', () => {
  beforeEach(() => setUiLanguage('zh'));
  afterEach(() => setUiLanguage('zh'));

  test('override label wins over the auto-derived type label', () => {
    expect(getPromptInputActionLabel('aiAct', 'Action')).toBe('Action');
    expect(getPromptInputActionLabel('aiTap', 'Send')).toBe('Send');
  });

  test('derives the label from the selected type when no override is given', () => {
    expect(getPromptInputActionLabel('aiAct')).toBe('自动操作（aiAct）');
    expect(getPromptInputActionLabel('aiTap')).toBe('点击（aiTap）');
    expect(getPromptInputActionLabel('aiAssert')).toBe('断言（aiAssert）');
    expect(getPromptInputActionLabel('aiQuery')).toBe('提取信息（aiQuery）');
    expect(getPromptInputActionLabel('aiDragAndDrop')).toBe(
      '拖拽（aiDragAndDrop）',
    );
    expect(getPromptInputActionLabel('Navigate')).toBe('打开网址（Navigate）');
    expect(getPromptInputActionLabel('CursorMove')).toBe(
      '移动文字光标（CursorMove）',
    );
    expect(getPromptInputActionLabel('aiWaitFor')).toBe(
      '等待条件（aiWaitFor）',
    );
  });

  test('switches API labels and the Playground title in both directions', () => {
    expect(t('API Playground')).toBe('API 操作调试（API Playground）');
    setUiLanguage('en');
    expect(getPromptInputActionLabel('aiAct')).toBe('Auto action');
    expect(getPromptInputActionLabel('aiTap')).toBe('Click');
    expect(getPromptInputActionLabel('aiAssert')).toBe('Assert');
    expect(t('API Playground')).toBe('API Playground');
    setUiLanguage('zh');
    expect(getPromptInputActionLabel('aiTap')).toBe('点击（aiTap）');
  });

  test('falls back to the default action label when neither an override nor a usable type exists', () => {
    expect(getPromptInputActionLabel('')).toBe('自动操作');
  });
});
