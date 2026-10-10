import { describe, expect, it } from '@rstest/core';
import { getPlaceholderForType } from '../src/utils/prompt-placeholder';

describe('getPlaceholderForType', () => {
  it('returns API-specific prompt placeholders', () => {
    expect(getPlaceholderForType('aiTap')).toBe('描述要点击的元素');
    expect(getPlaceholderForType('aiQuery')).toBe(
      '描述要提取的信息，例如：读取当前表格中的订单号和状态',
    );
    expect(getPlaceholderForType('aiAssert')).toBe(
      '描述要验证的条件，例如：页面显示「保存成功」',
    );
  });
});
