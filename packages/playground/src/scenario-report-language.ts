/** Translate generated recorder labels only; preserve user instructions and values. */
export function scenarioReportDescription(text: string, language?: string) {
  if (language === 'en') return text;
  const prefixes: Array<[string, string]> = [
    ['Navigate to ', '打开网页：'],
    ['Input into ', '填写：'],
    ['Tap ', '点击：'],
    ['Double click ', '双击：'],
    ['Hover ', '悬停：'],
    ['Scroll ', '滚动：'],
    ['Press ', '按键：'],
    ['Drag ', '拖动：'],
  ];
  const prefix = prefixes.find(([source]) => text.startsWith(source));
  return prefix ? prefix[1] + text.slice(prefix[0].length) : text;
}

export function scenarioReportDetail(text: string, language?: string) {
  if (language === 'en') return text;
  const exact: Record<string, string> = {
    'Native action dispatched; its business outcome was not independently verified.':
      '操作已执行，业务结果由检查点验证。',
    'Observed URL is recording context; no navigation outcome was verified.':
      '已记录网址变化，未重复打开页面。',
    'The checkpoint did not pass.': '检查点未通过。',
    'The assertion could not be evaluated.': '断言证据不足，无法判断。',
  };
  if (exact[text]) return exact[text];
  const route =
    /^Route transition verified: (.+)\. Query values and business results require their recorded checkpoints\.$/.exec(
      text,
    );
  return route ? `页面跳转已确认：${route[1]}。业务结果由检查点验证。` : text;
}
