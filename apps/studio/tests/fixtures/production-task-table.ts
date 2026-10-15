/** The virtual-row shape and compound task codes from the reported MOM run. */
export function productionTaskTable(
  options: {
    generation?: number;
    order?: string;
    operations?: number[];
    status?: string;
    codeMarkup?: 'link' | 'nested';
    extraCheckboxes?: boolean;
  } = {},
) {
  const {
    generation = 274,
    order = 'MO-M04-017',
    operations = [10, 20, 30, 40],
    status = '初始',
    codeMarkup = 'link',
    extraCheckboxes = false,
  } = options;
  const manufacturingOrder = `MO-${order}-${String(generation).padStart(4, '0')}`;
  const code = (value: string) =>
    codeMarkup === 'link'
      ? `<a>${value}</a>`
      : `<span style="display:flex"><div class="table-cell-ellipsis"><span class="table-cell-ellipsis k-filter-table-link-button" title="${value}">${value}</span></div><span class="k-copy-to-clipboard"><span title="点击复制"><svg width="12" height="12"></svg></span></span></span>`;
  return `<style>.ant-table > div { display: grid; grid-template-columns: 30px 40px 230px 160px 80px 80px 120px 200px; min-height: 32px; }</style><div class="ant-table"><div role="row"><div role="columnheader">选择</div><div role="columnheader">序号</div><div role="columnheader">编码</div><div role="columnheader">所属组织</div><div role="columnheader">业务状态</div><div role="columnheader">工序类型</div><div role="columnheader">生产订单</div><div role="columnheader">制造订单</div></div>${operations
    .map(
      (operation, index) =>
        `<div data-row-key="28071568469${generation}${operation}">${[
          `<label class="ant-checkbox-wrapper"><input type="checkbox" data-operation="${operation}"></label>`,
          String(index + 1),
          code(`${manufacturingOrder}:${operation}`),
          'BIZ-M04-S1 装配',
          status,
          operation === 40 ? '检验' : '加工',
          code(order),
          code(manufacturingOrder),
          ...(codeMarkup === 'nested'
            ? [order, manufacturingOrder, `${manufacturingOrder}:${operation}`]
            : []),
          ...(extraCheckboxes
            ? Array.from(
                { length: 10 },
                () =>
                  '<label class="ant-checkbox-wrapper ant-checkbox-wrapper-disabled"><input type="checkbox" disabled></label>',
              )
            : []),
        ]
          .map((content) => `<div role="cell">${content}</div>`)
          .join('')}</div>`,
    )
    .join('')}</div>`;
}
