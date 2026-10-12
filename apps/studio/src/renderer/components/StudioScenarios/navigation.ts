export const SCENARIO_NAVIGATION_EVENT = 'studio:before-scenario-navigation';

export interface ScenarioNavigationRequest {
  respond: (decision: boolean | Promise<boolean>) => void;
}

/** Check before mutating page/session state, including saved-page opening. */
export async function canNavigateStudio(): Promise<boolean> {
  let decision: boolean | Promise<boolean> = true;
  window.dispatchEvent(
    new CustomEvent<ScenarioNavigationRequest>(SCENARIO_NAVIGATION_EVENT, {
      detail: {
        respond: (next) => {
          decision = next;
        },
      },
    }),
  );
  return decision;
}

export function navigateStudio(action: () => void) {
  void canNavigateStudio().then((allowed) => {
    if (allowed) action();
  });
}
