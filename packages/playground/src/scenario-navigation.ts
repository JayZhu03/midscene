import type { ScenarioRunStep } from './scenario-contract';

export interface ScenarioNavigationEffect {
  beforeUrl: string;
  afterUrl: string;
  observationStepId: string;
}

/** Compare routes, not recorded query values (IDs, tokens and run parameters). */
export function scenarioRoute(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol))
      return '[unavailable route]';
    const hashRoute = url.hash.startsWith('#/')
      ? url.hash.slice(1).split('?')[0]
      : '';
    return `${url.origin}${url.pathname}${hashRoute ? `#${hashRoute}` : ''}`;
  } catch {
    return '[unavailable route]';
  }
}

/**
 * Session URL notifications can precede the action's asynchronously saved event.
 * Associate only explicit before/after evidence with that action's recorded
 * before URL; a bare historical URL remains context, never an active goto.
 */
export function scenarioNavigationEffect(
  steps: ScenarioRunStep[],
  index: number,
): ScenarioNavigationEffect | undefined {
  const event = steps[index]?.event;
  if (!event?.url || !['click', 'keydown'].includes(event.type)) return;
  for (const adjacent of [index + 1, index - 1]) {
    const observation = steps[adjacent];
    const navigation = observation?.event;
    if (
      observation?.type !== 'playwright-operation' ||
      navigation?.type !== 'navigation' ||
      (navigation.actionType !== 'NavigationChanged' &&
        navigation.rawPayload?.implicitNavigationState !== true)
    )
      continue;
    const beforeUrl = navigation.rawPayload?.beforeUrl;
    const afterUrl = navigation.rawPayload?.afterUrl;
    if (
      typeof beforeUrl !== 'string' ||
      typeof afterUrl !== 'string' ||
      !/^https?:\/\//i.test(beforeUrl) ||
      !/^https?:\/\//i.test(afterUrl) ||
      navigation.url !== afterUrl ||
      event.url !== beforeUrl ||
      scenarioRoute(beforeUrl) === scenarioRoute(afterUrl)
    )
      continue;
    // A preceding observation with a known non-session trigger belongs to
    // the previous action. Do not attach it to the next action.
    if (
      adjacent < index &&
      navigation.rawPayload?.triggerActionType !== 'SessionNavigation'
    )
      continue;
    // Session notifications can be saved before their buffered click. In
    // [open menu, observed route, click menu item], both clicks have the same
    // before URL. The following click's before-page snapshot takes precedence:
    // one observation must not require BOTH actions to cause that navigation.
    if (
      adjacent > index &&
      navigation.rawPayload?.triggerActionType === 'SessionNavigation'
    ) {
      const following = steps[adjacent + 1];
      if (
        following?.type === 'playwright-operation' &&
        following.event &&
        ['click', 'keydown'].includes(following.event.type) &&
        following.event.url === beforeUrl
      )
        continue;
    }
    return { beforeUrl, afterUrl, observationStepId: observation.id };
  }
}
