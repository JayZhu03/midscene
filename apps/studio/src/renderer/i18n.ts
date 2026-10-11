import {
  type UiLanguage,
  getUiLanguage,
  setUiLanguage,
  t as translate,
  useUiLanguage,
} from '@midscene/visualizer/ui-language';

export { useUiLanguage as useStudioLanguage };
const webMessages: Record<string, string> = {
  'No page opened': '尚未打开网页',
  'Unable to connect to this page.': '暂时无法连接此网页',
  Workbench: '工作台',
  'Open test page': '打开测试网页',
  'Model configured': '模型已配置',
  'Model not configured': '模型未配置',
  'Edit model configuration': '修改模型配置',
  'Configure model': '配置模型',
  Edit: '修改',
  'Page actions': '网页操作',
  'Rename page': '重命名',
  'Delete page': '删除网页',
  'Page name': '网页名称',
  'Remove this page from the list? Browser login data will be kept.':
    '从列表中删除此网页？浏览器登录信息会保留。',
  'Page size': '网页尺寸',
  'Page width': '网页宽度',
  'Page height': '网页高度',
  'Refresh pages': '刷新网页',
  'Web testing': '网页测试',
  'Open a page to start testing.': '打开网页，开始测试。',
  'Saved pages': '网页',
  'No saved pages': '尚未打开网页',
  'Unable to open page': '网页打开失败，请重试',
  'Please enter a valid HTTP or HTTPS URL.': '请输入有效的网址',
};
export function t(text: string, params?: Record<string, string | number>) {
  return getUiLanguage() === 'zh' && webMessages[text]
    ? webMessages[text]
    : translate(text, params);
}
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
