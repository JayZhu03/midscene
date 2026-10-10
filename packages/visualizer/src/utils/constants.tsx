import type { InfoListItem, PlaygroundResult } from '../types';
import { t } from '../ui-language';

// tracking popup tip
export const trackingTip = '在当前标签页打开链接';

// deep locate tip
export const deepLocateTip = '深度定位';

// deep think tip (for aiAct planning)
export const deepThinkTip = '深度思考';

// screenshot included tip
export const screenshotIncludedTip = '请求中包含截图';

// dom included tip
export const domIncludedTip = '请求中包含 DOM 信息';

// Android device options tips
export const imeStrategyTip = 'IME strategy';
export const screenshotStrategyTip = 'Screenshot strategy';
export const autoDismissKeyboardTip = 'Auto dismiss keyboard';
export const keyboardDismissStrategyTip = 'Keyboard dismiss strategy';
export const alwaysRefreshScreenInfoTip = 'Always refresh screen info';

export const apiMetadata = {
  aiAct: {
    group: 'interaction',
    title: '自动规划步骤并执行',
  },
  aiTap: { group: 'interaction', title: '点击元素' },
  aiDoubleClick: { group: 'interaction', title: '双击元素' },
  aiHover: { group: 'interaction', title: '悬停在元素上' },
  aiInput: { group: 'interaction', title: '向元素输入文字' },
  aiRightClick: { group: 'interaction', title: '右键点击元素' },
  aiKeyboardPress: { group: 'interaction', title: '按下键盘按键' },
  aiScroll: { group: 'interaction', title: '滚动页面或元素' },
  aiLocate: { group: 'interaction', title: '定位页面元素' },
  aiQuery: {
    group: 'extraction',
    title: '直接从界面提取信息',
  },
  aiBoolean: { group: 'extraction', title: '判断条件是否成立' },
  aiNumber: { group: 'extraction', title: '提取数值' },
  aiString: { group: 'extraction', title: '提取文字' },
  aiAsk: { group: 'extraction', title: '询问当前界面的信息' },
  aiAssert: { group: 'validation', title: '验证条件是否成立' },
  aiWaitFor: { group: 'validation', title: '等待条件满足' },
};

export const defaultMainButtons = ['aiAct', 'aiTap', 'aiQuery', 'aiAssert'];

// welcome message template
export const getWelcomeMessageTemplate = (
  targetName = t('网页'),
): Omit<InfoListItem, 'id' | 'timestamp'> => ({
  type: 'system',
  content: t(
    'Welcome to Midscene.js Playground!\n\nOperate {target} using natural language: click buttons, fill forms and extract information.\n\nEnter your instructions below to get started.',
    { target: targetName },
  ),
  loading: false,
  result: undefined,
  replayScriptsInfo: null,
  replayCounter: 0,
  loadingProgressText: '',
  verticalMode: false,
});

// keep backward compatibility
export const WELCOME_MESSAGE_TEMPLATE: Omit<InfoListItem, 'id' | 'timestamp'> =
  getWelcomeMessageTemplate();

// blank result template
export const BLANK_RESULT: PlaygroundResult = {
  result: undefined,
  dump: null,
  reportHTML: null,
  report: null,
  error: null,
};
