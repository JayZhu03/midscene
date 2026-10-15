import type { MidsceneRecorderNativeLocator } from '@midscene/shared/recorder';
import type {
  ScenarioRunStep,
  ScenarioStepPresentation,
} from './scenario-contract';
import { isScenarioNavigationObservation } from './scenario-navigation';

const useful = (value?: string) => {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text &&
    !/^(?:target element in |unresolved input field|AI is analyzing element)/i.test(
      text,
    )
    ? text.slice(0, 120)
    : undefined;
};

function locatorLabel(
  locator?: MidsceneRecorderNativeLocator,
): string | undefined {
  if (!locator) return undefined;
  const attribute =
    /\[(?:aria-label|placeholder|title)\s*=\s*["']([^"']+)["']\]/i.exec(
      locator.selector,
    )?.[1];
  return (
    useful(locator.text) ||
    useful(attribute) ||
    locatorLabel(locator.has) ||
    locatorLabel(locator.scope)
  );
}

export function scenarioStepPresentation(
  step: ScenarioRunStep,
): ScenarioStepPresentation | undefined {
  const event = step.event;
  if (step.type !== 'playwright-operation' || !event) return undefined;
  return {
    action: event.type,
    target:
      useful(event.semantic?.elementDescription) ||
      useful(event.elementDescription) ||
      locatorLabel(event.nativeTarget?.locator),
    page: event.title
      ?.split(/\s+[-–|]\s+/)[0]
      ?.trim()
      .slice(0, 120),
    url: event.url,
    editable: event.nativeTarget?.editable,
    contextOnly: isScenarioNavigationObservation(step),
  };
}

/** Read the target that Playwright actually resolved, before dispatch. No page
 * mutation, screenshot, network request or AI call is involved. */
export function describeScenarioTarget(element: Element) {
  const field = element.closest(
    'input, textarea, [contenteditable="true"]',
  ) as HTMLInputElement | null;
  const item = element.closest('.ant-form-item, .el-form-item');
  const fieldLabel =
    field?.labels?.[0]?.textContent ||
    item?.querySelector('.ant-form-item-label, .el-form-item__label')
      ?.textContent;
  const control =
    element.closest(
      'button, a, [role="button"], [role="menuitem"], [role="option"], label',
    ) || element;
  const clear = element.closest(
    '.ant-select-clear, .ant-select-selection-item-remove, .ant-input-clear-icon, [aria-label="clear"]',
  );
  const target = (
    ((field || clear) && fieldLabel) ||
    control.getAttribute('aria-label') ||
    control.getAttribute('title') ||
    field?.getAttribute('placeholder') ||
    (control as HTMLElement).innerText ||
    control.textContent ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:：*\s]+$/, '');
  return {
    target: target && target.length <= 120 ? target : undefined,
    editable: Boolean(field),
    ...(clear ? { action: 'clear' } : {}),
  };
}
