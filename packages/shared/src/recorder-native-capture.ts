import type {
  MidsceneRecorderNativeLocator,
  MidsceneRecorderNativeTarget,
} from './recorder';

/** All helpers live inside this function: Studio serializes it into the page. */
export function captureRecorderNativeTarget(
  payload: Record<string, unknown>,
  fallback?: (element: Element) => MidsceneRecorderNativeTarget,
): MidsceneRecorderNativeTarget {
  type Locator = MidsceneRecorderNativeLocator;
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const matchesGeneratedText = (
    text: string,
    template: NonNullable<Locator['generatedText']>,
  ) =>
    text.startsWith(template.prefix) &&
    text.endsWith(template.suffix) &&
    /^\d+$/.test(
      text.slice(template.prefix.length, text.length - template.suffix.length),
    );
  const attr = (name: string, value: string) =>
    `[${name}=${JSON.stringify(value)}]`;
  const visible = (node: Element) =>
    node.getClientRects().length > 0 &&
    getComputedStyle(node).visibility !== 'hidden';
  const cache = new Map<string, Element[]>();
  const resolve = (
    locator: Locator,
    root: Document | Element = document,
  ): Element[] => {
    const key = root === document ? JSON.stringify(locator) : undefined;
    if (key && cache.has(key)) return cache.get(key)!;
    const roots = locator.scope ? resolve(locator.scope, root) : [root];
    const matches = Array.from(
      new Set(
        roots.flatMap((scope) =>
          Array.from(scope.querySelectorAll(locator.selector)),
        ),
      ),
    ).filter(
      (node) =>
        (!locator.visible || visible(node)) &&
        (!locator.text || normalize(node.textContent || '') === locator.text) &&
        (!locator.generatedText ||
          matchesGeneratedText(
            normalize(node.textContent || ''),
            locator.generatedText,
          )) &&
        (!locator.has || resolve(locator.has, node).length > 0) &&
        (locator.hasAll || []).every(
          (child) => resolve(child, node).length > 0,
        ),
    );
    if (key) cache.set(key, matches);
    return matches;
  };
  const semanticClasses = [
    'ant-select-clear',
    'ant-select-arrow',
    'ant-select-selector',
    'ant-select-selection-item-remove',
    'ant-input-clear-icon',
    'ant-picker-clear',
    'ant-tree-switcher',
    'ant-tree-checkbox',
    'ant-tree-node-content-wrapper',
    'ant-checkbox-wrapper',
    'ant-radio-wrapper',
    'ant-switch',
    'ant-picker-cell-inner',
    'ant-picker-suffix',
  ];
  const useFocus =
    payload.actionType === 'KeyboardPress' ||
    (payload.actionType === 'Input' && payload.mode === 'typeOnly') ||
    typeof payload.x !== 'number' ||
    typeof payload.y !== 'number';
  let element: Element | null = useFocus
    ? document.activeElement
    : document.elementFromPoint(payload.x as number, payload.y as number);
  // Hit-test through open shadow roots instead of recording the host.
  while (element?.shadowRoot) {
    const inner: Element | null = useFocus
      ? element.shadowRoot.activeElement
      : element.shadowRoot.elementFromPoint(
          payload.x as number,
          payload.y as number,
        );
    if (!inner || inner === element) break;
    element = inner;
  }
  if (!element || element.matches('iframe, canvas')) {
    return { error: '未找到可定位的元素。' };
  }
  if (payload.actionType === 'Scroll') {
    const horizontal =
      payload.direction === 'left' ||
      payload.direction === 'right' ||
      payload.scrollType === 'scrollToLeft' ||
      payload.scrollType === 'scrollToRight';
    while (element && element !== document.documentElement) {
      const style = getComputedStyle(element);
      const offset = horizontal ? element.scrollLeft : element.scrollTop;
      const extent = horizontal
        ? element.scrollWidth - element.clientWidth
        : element.scrollHeight - element.clientHeight;
      const backwards =
        payload.direction === 'up' || payload.direction === 'left';
      const canMove = backwards ? offset > 0 : offset < extent - 1;
      const blocksChaining = /contain|none/.test(
        horizontal ? style.overscrollBehaviorX : style.overscrollBehaviorY,
      );
      const edgeScroll =
        typeof payload.scrollType === 'string' &&
        payload.scrollType !== 'singleAction';
      if (
        /auto|scroll/.test(horizontal ? style.overflowX : style.overflowY) &&
        (horizontal
          ? element.scrollWidth > element.clientWidth
          : element.scrollHeight > element.clientHeight) &&
        (edgeScroll || canMove || blocksChaining)
      )
        break;
      element =
        element.parentElement ||
        (element.getRootNode() instanceof ShadowRoot
          ? (element.getRootNode() as ShadowRoot).host
          : null);
    }
    if (!element || element === document.documentElement)
      element = document.scrollingElement || document.documentElement;
  } else if (
    payload.actionType === 'KeyboardPress' &&
    element.matches('body')
  ) {
    element = document.documentElement;
  } else {
    // Preserve the actual sub-control. A clear icon and a dropdown arrow can
    // overlap; promoting both to the select would change the recorded action.
    const subControl = element.closest(
      semanticClasses
        .filter((name) => name !== 'ant-select-selector')
        .map((name) => `.${name}`)
        .join(','),
    );
    const selectControl =
      payload.actionType !== 'Input' && payload.actionType !== 'KeyboardPress'
        ? element.closest('.ant-select-selector')
        : null;
    element =
      (payload.actionType === 'DragAndDrop'
        ? element.closest('[draggable="true"]')
        : null) ||
      subControl ||
      selectControl ||
      element.closest(
        'button, a, input, textarea, select, [role="button"], [role="menuitem"], [role="option"], [contenteditable="true"]',
      ) ||
      element;
    if (payload.actionType === 'Input' && !element.matches('input, textarea')) {
      const inputs = Array.from(
        element.querySelectorAll('input, textarea'),
      ).filter(visible);
      if (inputs.length === 1) element = inputs[0];
    }
  }
  if (
    element.matches('iframe, canvas') ||
    (element.matches('body') && payload.actionType !== 'Scroll')
  )
    return { error: '未找到可定位的元素。' };
  const input =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
      ? element
      : undefined;
  const result: MidsceneRecorderNativeTarget = {
    sensitive: input instanceof HTMLInputElement && input.type === 'password',
    editable:
      Boolean(input) ||
      (element instanceof HTMLElement && element.isContentEditable),
    ...(input && input.selectionStart !== null && input.selectionEnd !== null
      ? {
          selection: {
            start: input.selectionStart,
            end: input.selectionEnd,
            valueLength: input.value.length,
          },
        }
      : {}),
  };
  if (
    payload.actionType === 'DragAndDrop' &&
    typeof payload.x === 'number' &&
    typeof payload.y === 'number'
  ) {
    const box = element.getBoundingClientRect();
    result.position = {
      x:
        (payload.x - box.left - element.clientLeft) /
        Math.max(1, element.clientWidth),
      y:
        (payload.y - box.top - element.clientTop) /
        Math.max(1, element.clientHeight),
    };
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    const selection = window.getSelection();
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      if (
        element.contains(range.startContainer) &&
        element.contains(range.endContainer)
      ) {
        const prefix = document.createRange();
        prefix.selectNodeContents(element);
        prefix.setEnd(range.startContainer, range.startOffset);
        const start = prefix.toString().length;
        prefix.setEnd(range.endContainer, range.endOffset);
        result.contentEditableSelection = {
          start,
          end: prefix.toString().length,
        };
      }
    }
  }
  // Native querySelector cannot cross shadow boundaries. The Playwright
  // generator can, and verifies the returned selector against this exact node.
  if (element.getRootNode() instanceof ShadowRoot)
    return {
      ...result,
      ...(fallback?.(element) || { error: '此元素需要 Playwright 定位。' }),
    };
  const attributes = [
    'data-testid',
    'data-test-id',
    'data-test',
    'data-cy',
    'data-qa',
    'aria-label',
    'placeholder',
    'name',
    'label',
    'title',
    'data-row-key',
    'data-column-key',
    'data-node-key',
  ];
  const stableId = (id: string) =>
    id.length < 120 &&
    !/^(rc_|react|:r|headlessui|radix)|^filter-form-[a-z\d]{6}$|[a-f\d]{16,}|\d{8,}/i.test(
      id,
    );
  const simple = (node: Element, includeText: boolean): Locator[] => {
    const tag = node.tagName.toLowerCase();
    const candidates: Locator[] = [];
    for (const name of attributes) {
      const value = node.getAttribute(name);
      if (value && value.length < 200)
        candidates.push({ selector: tag + attr(name, value), visible: true });
    }
    if (node.id && stableId(node.id))
      candidates.push({ selector: tag + attr('id', node.id), visible: true });
    if (tag === 'html') candidates.push({ selector: 'html', visible: true });
    const classes = semanticClasses.filter((name) =>
      node.classList.contains(name),
    );
    for (const name of classes)
      candidates.push({ selector: `.${name}`, visible: true });
    const role = node.getAttribute('role');
    const selector = role ? tag + attr('role', role) : tag;
    // A separate button label remains usable when a sibling badge/count changes.
    if (includeText && node.matches('button, [role="button"]')) {
      for (const child of Array.from(node.querySelectorAll('span')).slice(
        0,
        12,
      )) {
        const text = normalize(child.textContent || '');
        if (
          text &&
          text.length < 80 &&
          /[^\d\s\W]|[\u3400-\u9fff]/u.test(text) &&
          !child.closest('.ant-badge, .ant-tag')
        ) {
          candidates.push({
            selector,
            visible: true,
            has: { selector: 'span', text },
          });
        }
      }
    }
    const text = normalize(node.textContent || '');
    if (
      includeText &&
      text &&
      text.length < 160 &&
      !node.matches('input, textarea, select')
    )
      candidates.push({ selector, text, visible: true });
    if (role) candidates.push({ selector, visible: true });
    candidates.push({ selector: tag, visible: true });
    return candidates;
  };
  const rowSelector = 'tr, [role="row"], [data-row-key]';
  const cellSelector = 'td, [role="cell"], .ant-table-cell';
  const leaf = simple(element, true);
  const pick = (
    candidate: Locator,
    strategy: MidsceneRecorderNativeTarget['strategy'],
  ) => {
    const matches = resolve(candidate);
    // Uniqueness alone is insufficient: it must be the element that was hit.
    return matches.length === 1 && matches[0] === element
      ? { ...result, locator: candidate, strategy }
      : undefined;
  };
  const businessKey = (value: string) =>
    value.length >= 4 &&
    value.length < 160 &&
    /[a-z]/i.test(value) &&
    /\d/.test(value) &&
    !/\s/.test(value);
  const rowRecipes = (row: Element): Locator[] => {
    const selector = row.matches('[data-row-key]')
      ? `${row.tagName.toLowerCase()}[data-row-key]`
      : row.matches('[role="row"]')
        ? '[role="row"]'
        : 'tr';
    const cells = Array.from(row.querySelectorAll(cellSelector)).filter(
      (cell) => cell.closest(rowSelector) === row && visible(cell),
    );
    const identities = cells.flatMap((cell) => {
      // Links often contain the business code beside a separate copy icon.
      // Preserve that label, not the mutable status or action text of the row.
      const links = Array.from(cell.querySelectorAll('a')).filter(visible);
      const nodes = links.length ? links : [cell];
      return nodes.flatMap((node) => {
        const text = normalize(node.textContent || '');
        if (!businessKey(text)) return [];
        const identity = (template?: Locator['generatedText']): Locator => ({
          selector: cellSelector,
          visible: true,
          ...(node === cell
            ? template
              ? { generatedText: template }
              : { text }
            : {
                has: {
                  selector: 'a',
                  visible: true,
                  ...(template ? { generatedText: template } : { text }),
                },
              }),
        });
        return [{ text, identity }];
      });
    });
    const recipes: Locator[] = [];
    const key = row.getAttribute('data-row-key') || '';
    const generatedKey =
      /^\d{8,}$|^[a-f\d]{16,}$|^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(
        key,
      );
    // A regenerated task can change both its database ID and manufacturing
    // order number. Recognize a compound child key only when this same row
    // corroborates its complete parent code AND a containing business key.
    // Keep that ancestor and the child suffix together; a bare operation
    // number, row index or common status is never sufficient identification.
    for (const child of identities) {
      const compound = /^(.+):(\d{1,6})$/.exec(child.text);
      const serial = compound && /^(.+[-_/])(\d{2,})$/.exec(compound[1]);
      if (
        !generatedKey ||
        !compound ||
        !serial ||
        !identities.some((item) => item.text === compound[1])
      )
        continue;
      const ancestors = identities.filter(
        (item) =>
          item.text !== compound[1] &&
          serial[1].endsWith(`${item.text}${serial[1].slice(-1)}`) &&
          !item.text.includes(':'),
      );
      for (const ancestor of ancestors)
        recipes.push({
          selector,
          visible: true,
          hasAll: [
            ancestor.identity(),
            child.identity({ prefix: serial[1], suffix: `:${compound[2]}` }),
          ],
        });
    }
    for (const item of identities)
      recipes.push({ selector, visible: true, has: item.identity() });
    return recipes;
  };
  const row = element.closest(rowSelector);
  const requireRowContext =
    row &&
    !row.querySelector('th, [role="columnheader"]') &&
    (row.hasAttribute('data-row-key') || rowRecipes(row).length > 0);
  for (const candidate of leaf) {
    // Even a currently unique checkbox must retain its business-row context.
    // Headers and layout tables keep their existing attribute-based locators.
    if (
      requireRowContext &&
      !/\[(?:data-testid|data-test-id|data-test|data-cy|data-qa|id)=/.test(
        candidate.selector,
      )
    )
      continue;
    if (
      candidate.text ||
      candidate.has ||
      candidate.selector === element.tagName.toLowerCase() ||
      candidate.selector.includes('[role=')
    )
      continue;
    const found = pick(candidate, 'attribute');
    if (found) return found;
  }
  const contexts: Array<{ node: Element; recipes: Locator[] }> = [];
  let parent = element.parentElement;
  for (
    let depth = 0;
    parent && depth < 24;
    depth++, parent = parent.parentElement
  ) {
    const recipes = simple(parent, false).filter(
      (recipe) =>
        recipe.selector.includes('[') && !recipe.selector.includes('[role='),
    );
    if (parent.matches('.ant-form-item')) {
      const label = parent.querySelector('.ant-form-item-label label');
      const text = normalize(label?.textContent || '');
      if (text)
        recipes.push({
          selector: '.ant-form-item',
          visible: true,
          has: { selector: '.ant-form-item-label label', text },
        });
    }
    if (
      parent.matches(rowSelector) &&
      !parent.querySelector('th, [role="columnheader"]')
    ) {
      // Virtual tables use div[data-row-key] with td/role=cell descendants.
      // Prefer rendered business identity to their opaque database row key.
      recipes.unshift(...rowRecipes(parent));
      for (const cell of Array.from(
        parent.querySelectorAll('td, [role="cell"]'),
      ).slice(0, 4)) {
        const text = normalize(cell.textContent || '');
        if (
          text &&
          text.length < 120 &&
          !/^\d+(\.\d+)?$/.test(text) &&
          !cell.querySelector('button, input, a')
        )
          recipes.push({
            selector: parent.tagName.toLowerCase(),
            visible: true,
            has: { selector: cell.tagName.toLowerCase(), text },
          });
      }
    }
    for (const [container, heading] of [
      ['.ant-modal-content', '.ant-modal-title'],
      ['.ant-drawer-content', '.ant-drawer-title'],
      ['.ant-card', '.ant-card-head-title'],
      ['fieldset', 'legend'],
      ['section', 'h1, h2, h3, h4'],
    ]) {
      if (!parent.matches(container)) continue;
      const text = normalize(parent.querySelector(heading)?.textContent || '');
      if (text && text.length < 120)
        recipes.push({
          selector: container,
          visible: true,
          has: { selector: heading, text },
        });
    }
    if (
      parent.matches(
        '[role="dialog"], [role="tooltip"], [role="listbox"], [role="tree"], form',
      )
    )
      recipes.push({
        selector: parent.getAttribute('role')
          ? attr('role', parent.getAttribute('role')!)
          : 'form',
        visible: true,
      });
    if (recipes.length) contexts.push({ node: parent, recipes });
  }
  const structuralAnchors: Array<{ node: Element; scope: Locator }> = [];
  const rememberAnchor = (node: Element, scope: Locator) => {
    const matches = resolve(scope);
    if (matches.length === 1 && matches[0] === node)
      structuralAnchors.push({ node, scope });
  };
  for (let index = 0; index < contexts.length; index++) {
    for (const scope of contexts[index].recipes) {
      rememberAnchor(contexts[index].node, scope);
      for (const candidate of leaf) {
        const found = pick({ ...candidate, scope }, 'context');
        if (found) return found;
      }
      // A repeated field label can be disambiguated by its enclosing modal/card.
      for (const outer of contexts.slice(index + 1)) {
        for (const outerScope of outer.recipes) {
          const nestedScope = { ...scope, scope: outerScope };
          rememberAnchor(contexts[index].node, nestedScope);
          for (const candidate of leaf) {
            const found = pick({ ...candidate, scope: nestedScope }, 'context');
            if (found) return found;
          }
        }
      }
    }
  }
  for (const candidate of leaf.filter(
    (candidate) => candidate.text || candidate.has,
  )) {
    const found = pick(candidate, 'text');
    if (found) return found;
  }
  // Structural paths are bounded by a unique semantic container; never pick
  // the first repeated global button or a bare page-wide positional index.
  for (const { node, scope } of structuralAnchors) {
    if (
      !element.matches('input, textarea, select') &&
      !semanticClasses.some((name) => element!.classList.contains(name))
    ) {
      const identity = leaf.find(
        (candidate) => candidate.text || candidate.has,
      );
      if (!identity || resolve({ ...identity, scope }).length !== 1) continue;
    }
    const path: string[] = [];
    let current: Element | null = element;
    while (current && current !== node && path.length < 16) {
      const tag = current.tagName.toLowerCase();
      const siblings: Element[] = Array.from(
        current.parentElement?.children || [],
      ).filter((sibling) => sibling.tagName === current!.tagName);
      path.unshift(
        siblings.length > 1
          ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})`
          : tag,
      );
      current = current.parentElement;
    }
    if (current !== node) continue;
    const guard =
      element.matches('input, textarea, select') ||
      semanticClasses.some((name) => element!.classList.contains(name))
        ? undefined
        : leaf.find((candidate) => candidate.text || candidate.has);
    const found = pick(
      {
        selector: `:scope > ${path.join(' > ')}`,
        scope,
        visible: true,
        ...(guard?.text ? { text: guard.text } : {}),
        ...(guard?.has ? { has: guard.has } : {}),
      },
      'structure',
    );
    if (found) return found;
  }
  return {
    ...result,
    ...(fallback?.(element) || { error: '无法唯一定位，请重新录制。' }),
  };
}
