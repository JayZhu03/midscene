import type { MidsceneRecorderNativeLocator } from '@midscene/shared/recorder';
import type { Page } from 'playwright-core';
import type { ScenarioRunStep } from './scenario-contract';
import { sameScenarioPage } from './scenario-navigation';

/**
 * Old recordings treated a generated filter ID as a stable scope. Rebind only
 * that scope, corroborated by the recorded dialog name and a unique live form.
 * Never remove a scope, pick a global input, or use screen coordinates.
 */
export async function rebindScenarioFilterLocator(
  page: Page,
  step: ScenarioRunStep,
): Promise<
  { locator: MidsceneRecorderNativeLocator; dialogTitle: string } | undefined
> {
  const event = step.event;
  const locator = event?.nativeTarget?.locator;
  if (event?.source !== 'studio-preview' || !locator) return;
  if (event.url && !sameScenarioPage(event.url, page.url())) return;
  const scopes: MidsceneRecorderNativeLocator[] = [];
  for (let scope = locator.scope; scope; scope = scope.scope) {
    if (/^div\[id="filter-form-[a-z\d]{6}"\]$/i.test(scope.selector)) {
      // Extra conditions on the old container cannot safely be discarded.
      if (
        scope.text ||
        scope.has ||
        scope.hasAll?.length ||
        scope.generatedText
      )
        return;
      scopes.push(scope);
    }
  }
  if (scopes.length !== 1) return;
  const descriptions = [
    step.description,
    event.semantic?.elementDescription,
    event.elementDescription,
  ].filter((text): text is string => Boolean(text));
  const containers = await page
    .locator('div.filter-form-wrapper[id^="filter-form-"]')
    .filter({ visible: true })
    .evaluateAll((nodes) =>
      nodes.flatMap((node) => {
        const dialog = node.closest('.ant-modal-content');
        if (!dialog || !dialog.getClientRects().length) return [];
        const title = Array.from(
          dialog.querySelectorAll('.ant-modal-title'),
        ).find((heading) => heading.closest('.ant-modal-content') === dialog);
        return [
          {
            id: node.id,
            title: title?.textContent?.replace(/\s+/g, ' ').trim() || '',
          },
        ];
      }),
    );
  const candidates = containers.filter(
    (container) =>
      /^filter-form-[a-z\d]{6}$/i.test(container.id) &&
      container.title.length >= 2 &&
      descriptions.some((description) => {
        const title = container.title;
        return (
          [`“${title}”`, `"${title}"`, `「${title}」`, `'${title}'`].some(
            (quoted) => description.includes(quoted),
          ) ||
          description.includes(`${title}弹窗`) ||
          description.includes(`${title}对话框`)
        );
      }),
  );
  // Multiple same-named dialogs/forms remain ambiguous, even if a leaf might
  // happen to be unique while one of the dialogs is still rendering.
  if (candidates.length !== 1) return;
  const candidate = candidates[0];
  const replace = (
    spec: MidsceneRecorderNativeLocator,
  ): MidsceneRecorderNativeLocator => ({
    ...spec,
    ...(spec === scopes[0]
      ? {
          selector: `div.filter-form-wrapper[id=${JSON.stringify(candidate.id)}]`,
        }
      : {}),
    ...(spec.scope ? { scope: replace(spec.scope) } : {}),
  });
  return { locator: replace(locator), dialogTitle: candidate.title };
}
