import {
  type UiLanguage,
  getUiLanguage,
  setUiLanguage,
  t as translate,
  useUiLanguage,
} from '@midscene/visualizer/ui-language';

export { useUiLanguage as useStudioLanguage };
const webMessages: Record<string, string> = {
  'Use current session': '沿用当前会话',
  'Fresh session': '全新会话',
  'Return to original session': '返回原会话',
  'Unable to save session preference.': '运行方式保存失败，请重试',
  'Fresh sessions are not supported by this browser.':
    '当前浏览器不支持全新会话',
  'No original session is available.': '原会话已不可用',
  'Stop the current task before switching sessions.':
    '请先停止当前任务再切换会话',
  Execution: '执行',
  'Execution progress': '执行进度',
  'Completed steps': '已完成步骤',
  'Starting execution': '正在启动',
  'Preparing execution': '正在准备执行…',
  'Unable to start execution': '执行未启动，请返回后重试',
  'View execution': '查看执行',
  'AI summary': 'AI 总结',
  'Generating summary…': '正在生成总结…',
  'AI summary unavailable. Execution results are retained.':
    'AI 总结生成失败，执行结果已保留。',
  Rename: '重命名',
  'Script actions': '脚本操作',
  'Click for actions; drag to reorder': '点击打开菜单，拖动调整顺序',
  'Run this script': '执行',
  'Rename script': '重命名脚本',
  'Delete script': '删除脚本',
  'Delete this script?': '确认删除此脚本？',
  'Recorded input value is missing.': '脚本缺少录制输入值，请重新录制此步骤',
  'Sensitive input failed. Check the field and retry.':
    '密码输入失败，请检查输入框后重试',
  'Run scenario': '执行',
  'Script sequence': '脚本顺序',
  'Start with scenario': '随场景开始',
  'Automatic continuation': '自动继续',
  'Manual continuation': '手动继续',
  'Reorder script': '调整脚本顺序',
  'Drag to reorder; use arrow keys to move': '拖动排序，也可使用上下方向键移动',
  'Move up': '上移',
  'Move down': '下移',
  'Next step': '下一步',
  'Not started': '未执行',
  'Waiting for next': '等待下一步',
  Running: '执行中',
  Passed: '通过',
  Failed: '失败',
  Stopped: '已停止',
  Stopping: '正在停止',
  Completed: '已完成',
  'Stop the scenario before leaving.': '请先停止场景执行',
  'Unable to save script order.': '顺序保存失败，请重试',
  'Unable to load script order.': '脚本顺序读取失败',
  'Connect a page before running a scenario.': '请先打开网页',
  'Execution status unavailable. Reconnecting…':
    '暂时无法获取执行状态，正在重连',
  'Stop the current task before running a scenario.': '请先停止当前任务',
  'The checkpoint did not pass.': '检查点未通过',
  'The page is still loading or changing. The assertion was not evaluated.':
    '页面加载未完成或持续变化，尚未判断断言',
  'Recorded operation no longer matches its saved script. Re-record this script.':
    '录制操作与脚本不一致，请重新录制',
  'The recorded target is missing or is not unique.':
    '未找到唯一的录制目标，执行已停止',
  'The recorded page structure has changed.': '页面结构已变化，执行已停止',
  'The current page does not match this script’s starting page.':
    '当前页面与脚本起始页面不一致',
  'Scenario execution requires the Studio web browser.':
    '请先打开 Studio 网页会话',
  'Workspace mode': '工作区模式',
  'API debugging': 'API 调试',
  'Original mode': '原版模式',
  'Scenario mode': '场景模式',
  Scenarios: '场景',
  'Scenario list': '场景列表',
  'Execution records': '执行记录',
  'No scenarios yet': '暂无场景',
  'New scenario': '新建场景',
  'Edit scenario': '编辑场景',
  'Delete scenario': '删除场景',
  'Scenario actions': '场景操作',
  'Scenario name': '场景名称',
  'Scenario description (optional)': '场景介绍（选填）',
  'Please enter a scenario name.': '请输入场景名称',
  'Back to scenarios': '返回场景列表',
  'No scripts yet': '暂无脚本',
  'Record new script': '录制新脚本',
  'Insert checkpoint': '插入检查点',
  Checkpoint: '检查点',
  'Agent operation': 'Agent 操作',
  'Edit script': '编辑脚本',
  'Edit steps': '编辑步骤',
  'Edit step': '编辑',
  'Step actions': '步骤操作',
  'Step instruction': '步骤要求',
  'Insert step': '插入步骤',
  Assertion: '断言',
  'Describe the expected result': '描述需要检查的预期结果',
  'Describe what Agent should do': '描述需要 Agent 完成的操作',
  'Please enter a step instruction.': '请输入步骤要求',
  'Playwright steps cannot be edited.': 'Playwright 步骤不可修改',
  'This script changed. Reopen it before editing.':
    '脚本已更新，请重新打开后编辑',
  'Add assertion': '添加断言',
  'Add Agent operation': '添加 Agent 操作',
  'Playwright step is read-only': 'Playwright 步骤只读',
  'Save changes': '保存修改',
  'No changes to save.': '没有需要保存的修改',
  'Unable to update script.': '脚本更新失败，请重试',
  Insert: '插入',
  'Expected result': '预期结果',
  'Please enter an expectation.': '请输入预期结果',
  'Stop recording': '停止录制',
  'Starting recording': '正在开始录制',
  'Finishing recognition': '正在完成识别',
  'Save script': '保存脚本',
  'Script name': '脚本名称',
  'Please enter a script name.': '请输入脚本名称',
  'Back to scenario': '返回当前场景',
  'Step details': '步骤详情',
  'No recorded steps yet': '暂无录制步骤',
  'Loading scripts': '正在加载脚本',
  'Unsaved script': '脚本尚未保存',
  Discard: '放弃',
  'Keep editing': '继续编辑',
  'This script has not been saved. Discard it and leave?':
    '此脚本尚未保存，确定放弃并离开？',
  'Stop recording before leaving.': '请先停止录制再离开',
  'Unable to load scripts.': '无法读取脚本',
  'Unable to start recording.': '无法开始录制',
  'Unable to stop recording.': '无法停止录制，请重试',
  'Unable to insert checkpoint.': '无法插入检查点，请重试',
  'Unable to save recording screenshots.': '无法保存录制截图',
  'Unable to save script. Please retry.': '无法保存脚本，请重试',
  'Unable to discard script.': '无法放弃脚本，请重试',
  'Unable to prepare script steps.': '无法整理脚本步骤',
  'Delete this scenario?': '确定删除此场景？',
  'Local storage is full. Unable to save.': '本地存储空间不足，无法保存',
  'Local storage is unavailable. Unable to save.': '无法访问本地存储，无法保存',
  'Unable to save scenarios locally. Please retry.': '场景保存失败，请重试',
  'No execution records yet': '暂无执行记录',
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
