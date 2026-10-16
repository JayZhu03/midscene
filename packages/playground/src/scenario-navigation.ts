import type { ScenarioRunStep } from './scenario-contract';

export interface ScenarioNavigationEffect {
  beforeUrl: string;
  afterUrl: string;
  observationStepId: string;
  /** Current-run evidence only; never saved back into the recorded script. */
  runtime?: { beforeUrl: string; targetUrl?: string };
}

export function isScenarioWaitOnly(step: ScenarioRunStep) {
  return (
    step.type === 'agent-task' &&
    Boolean(step.agentPlan?.actions.length) &&
    step.agentPlan!.actions.every((action) => action.type === 'wait')
  );
}

export function isScenarioCheckEntry(step: ScenarioRunStep | undefined) {
  return (
    step?.type === 'agent-assertion' ||
    (step?.type === 'agent-task' &&
      step.agentPlan?.actions.find((action) => action.type !== 'wait')?.type ===
        'assertion')
  );
}

/** A recorded URL notification does not dispatch a new browser action. */
export function isScenarioNavigationObservation(
  step: ScenarioRunStep,
): boolean {
  const event = step.event;
  return (
    step.type === 'playwright-operation' &&
    event?.type === 'navigation' &&
    !['GoBack', 'GoForward', 'Reload'].includes(event.actionType || '') &&
    (event.actionType === 'NavigationChanged' ||
      Boolean(event.rawPayload?.implicitNavigationState))
  );
}

/** Keep passive route notifications inside the triggering action's window. */
export function scenarioOperationPrecedesAssertion(
  steps: ScenarioRunStep[],
  index: number,
): boolean {
  const step = steps[index];
  if (
    !step ||
    step.type === 'agent-assertion' ||
    isScenarioWaitOnly(step) ||
    isScenarioNavigationObservation(step)
  )
    return false;
  let next = index + 1;
  while (
    steps[next] &&
    (isScenarioNavigationObservation(steps[next]) ||
      isScenarioWaitOnly(steps[next]))
  )
    next++;
  return isScenarioCheckEntry(steps[next]);
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

function routeParts(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    const hash = url.hash.startsWith('#/') ? url.hash.slice(1) : undefined;
    const [path, query] = (hash ?? `${url.pathname}${url.search}`).split('?');
    return {
      origin: url.origin,
      shell: hash === undefined ? '' : url.pathname,
      hash: hash !== undefined,
      path,
      query: new URLSearchParams(query),
    };
  } catch {
    return;
  }
}

// View-instance tokens are not business IDs. Keep the view's name and every
// other path segment; never turn an arbitrary trailing segment into a wildcard.
function transientSegment(segment: string) {
  return /^([a-z][a-z\d-]*)-\d{13}-[a-z\d]{8}$/i.exec(segment)?.[1];
}

export function isScenarioTransientUrl(value: string): boolean {
  return Boolean(routeParts(value)?.path.split('/').some(transientSegment));
}

function sameRouteShape(
  recorded: string,
  current: string,
  liveLink: boolean,
  depth = 0,
): boolean {
  const a = routeParts(recorded);
  const b = routeParts(current);
  if (
    !a ||
    !b ||
    a.origin !== b.origin ||
    a.shell !== b.shell ||
    a.hash !== b.hash
  )
    return false;
  const left = a.path.split('/');
  const right = b.path.split('/');
  if (left.length !== right.length) return false;
  const identifier = (segment: string) => {
    if (/^\d+$/.test(segment)) return 'number';
    if (/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(segment))
      return 'uuid';
    if (/^[a-f\d]{16,}$/i.test(segment)) return 'hex';
    return undefined;
  };
  if (
    !left.every((segment, index) => {
      if (segment === right[index]) return true;
      const type = transientSegment(segment);
      if (type && type === transientSegment(right[index])) return true;
      // A business ID can change only with a current, uniquely located link as
      // independent evidence. A number/UUID alone does not authorize rebinding.
      const id = liveLink && identifier(segment);
      return Boolean(id && id === identifier(right[index]));
    })
  )
    return false;
  // Shared detail hosts can render different modules. Preserve their source
  // route when recorded, instead of accepting any detail page on this host.
  const from = a.query.get('from');
  const currentFrom = b.query.get('from');
  if (!from || from === currentFrom) return true;
  if (!currentFrom || depth >= 4) return false;
  try {
    return sameRouteShape(
      new URL(from, a.origin).href,
      new URL(currentFrom, b.origin).href,
      false,
      depth + 1,
    );
  } catch {
    return false;
  }
}

/** Readiness/locator context, not proof of an action or a business assertion. */
export function sameScenarioPage(recorded: string, current: string): boolean {
  const route = scenarioRoute(recorded);
  return (
    route !== '[unavailable route]' &&
    (isScenarioTransientUrl(recorded)
      ? sameRouteShape(recorded, current, false)
      : route === scenarioRoute(current))
  );
}

/** A live anchor may bind typed data IDs; it must still point to the same page
 * structure, origin and app as the recorded destination. */
export function scenarioLiveNavigationTarget(
  effect: ScenarioNavigationEffect,
  href: string | undefined,
): string | undefined {
  if (href && sameRouteShape(effect.afterUrl, href, true)) return href;
}

/** Both native execution and recovery must use this predicate. */
export function scenarioNavigationMatches(
  effect: ScenarioNavigationEffect,
  currentUrl: string,
): boolean {
  const destination = effect.runtime?.targetUrl;
  if (
    destination
      ? scenarioRoute(destination) !== scenarioRoute(currentUrl) ||
        !sameScenarioPage(destination, currentUrl)
      : !sameScenarioPage(effect.afterUrl, currentUrl)
  )
    return false;
  // A new temporary token must not certify an ineffective click on an already
  // open detail page. Compare against this run's pre-action URL, not its history.
  const beforeUrl = effect.runtime?.beforeUrl ?? effect.beforeUrl;
  return (
    !isScenarioTransientUrl(effect.afterUrl) ||
    scenarioRoute(beforeUrl) !== scenarioRoute(currentUrl)
  );
}

/** The Agent sees the stable route contract, not an obsolete view token. */
export function scenarioNavigationExpectation(
  effect: ScenarioNavigationEffect,
) {
  const parts = routeParts(effect.afterUrl);
  const expectedRoute = scenarioRoute(effect.afterUrl);
  return {
    beforeRoute: scenarioRoute(effect.runtime?.beforeUrl ?? effect.beforeUrl),
    expectedRoute: isScenarioTransientUrl(effect.afterUrl)
      ? expectedRoute.replace(
          /([a-z][a-z\d-]*)-\d{13}-[a-z\d]{8}(?=\/|$)/gi,
          '$1-:instance',
        )
      : expectedRoute,
    sourceRoute: parts?.query.get('from') || undefined,
    liveTargetRoute: effect.runtime?.targetUrl
      ? scenarioRoute(effect.runtime.targetUrl)
      : undefined,
    observationStepId: effect.observationStepId,
    transientInstance: isScenarioTransientUrl(effect.afterUrl),
  };
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
