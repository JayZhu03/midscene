import { t } from '../ui-language';
const actionLabels: Record<string, string> = {
  aiAct: '自动操作',
  aiTap: '点击',
  aiDoubleClick: '双击',
  aiHover: '悬停',
  aiInput: '输入',
  aiRightClick: '右键点击',
  aiKeyboardPress: '键盘按键',
  aiScroll: '滚动',
  aiLocate: '定位',
  aiQuery: '提取信息',
  aiBoolean: '判断条件',
  aiNumber: '提取数值',
  aiString: '提取文字',
  aiAsk: '询问页面',
  aiAssert: '断言',
  aiWaitFor: '等待条件',
};

export const actionNameForType = (type: string) => {
  if (!type) return '';
  if (Object.hasOwn(actionLabels, type)) return t(actionLabels[type]);

  // Remove 'ai' prefix and convert camelCase to space-separated words
  const typeWithoutAi = type.startsWith('ai') ? type.slice(2) : type;

  // Special handling for iOS-specific actions to preserve their full names
  if (typeWithoutAi.startsWith('IOS')) {
    // For IOS actions, keep IOS as a unit and add spaces before remaining capital letters
    return typeWithoutAi
      .substring(3)
      .replace(/([A-Z])/g, ' $1')
      .replace(/^/, 'IOS')
      .trim();
  }

  const fullName = typeWithoutAi.replace(/([A-Z])/g, ' $1').trim();

  // For long names, keep the last 3 words to make them shorter
  const words = fullName.split(' ');
  const result = words.length > 3 ? words.slice(-3).join(' ') : fullName;

  // Capitalize the first letter of each word for consistent display
  return result.replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * Resolves the label shown on the prompt input primary action button.
 *
 * Priority:
 *   1. `overrideLabel` — when provided, it wins unconditionally. This lets an
 *      embedding host pin a stable label regardless of the current type.
 *   2. `actionNameForType(type)` — the auto-derived label for the selected type.
 *   3. Literal `'自动操作'` — last-resort fallback when neither is available.
 */
export const getPromptInputActionLabel = (
  type: string,
  overrideLabel?: string,
) => {
  if (overrideLabel) return overrideLabel;
  return actionNameForType(type) || t('自动操作');
};
