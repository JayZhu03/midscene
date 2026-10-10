import { t } from '../ui-language';
// Get placeholder text based on run type
export const getPlaceholderForType = (type: string): string => {
  if (type === 'aiQuery') {
    return t('描述要提取的信息，例如：读取当前表格中的订单号和状态');
  }
  if (type === 'aiAssert') {
    return t('描述要验证的条件，例如：页面显示「保存成功」');
  }
  if (type === 'aiTap') {
    return t('描述要点击的元素');
  }
  if (type === 'aiDoubleClick') {
    return t('描述要双击的元素');
  }
  if (type === 'aiHover') {
    return t('描述要悬停的元素');
  }
  if (type === 'aiInput') {
    return '格式：<输入内容> | <目标元素>\n示例：测试订单 | 搜索框';
  }
  if (type === 'aiRightClick') {
    return t('描述要右键点击的元素');
  }
  if (type === 'aiKeyboardPress') {
    return '格式：<按键> | <目标元素（可选）>\n示例：Enter | 输入框';
  }
  if (type === 'aiScroll') {
    return '格式：<方向> <距离> | <目标元素（可选）>\n示例：down 500 | 主内容区域';
  }
  if (type === 'aiLocate') {
    return t('描述要定位的元素');
  }
  if (type === 'aiBoolean') {
    return t('描述要判断的条件（返回 true/false）');
  }
  if (type === 'aiNumber') {
    return t('描述要提取的数值');
  }
  if (type === 'aiString') {
    return t('描述要提取的文字');
  }
  if (type === 'aiAsk') {
    return t('输入你对当前页面的问题');
  }
  if (type === 'aiWaitFor') {
    return t('描述要等待满足的条件');
  }
  return t('描述你想完成的操作，例如：打开订单列表，筛选待审核订单');
};
