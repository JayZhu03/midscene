import { describe, expect, test } from '@rstest/core';
import { getPromptInputActionLabel } from '../src/utils/action-label';

describe('getPromptInputActionLabel', () => {
  test('override label wins over the auto-derived type label', () => {
    expect(getPromptInputActionLabel('aiAct', 'Action')).toBe('Action');
    expect(getPromptInputActionLabel('aiTap', 'Send')).toBe('Send');
  });

  test('derives the label from the selected type when no override is given', () => {
    expect(getPromptInputActionLabel('aiAct')).toBe('自动操作');
    expect(getPromptInputActionLabel('aiTap')).toBe('点击');
  });

  test('falls back to the default action label when neither an override nor a usable type exists', () => {
    expect(getPromptInputActionLabel('')).toBe('自动操作');
  });
});
