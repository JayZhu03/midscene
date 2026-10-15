import { describe, expect, test } from '@rstest/core';
import type { ScenarioRunStep } from '../../src/scenario-contract';
import {
  isScenarioNavigationObservation,
  scenarioNavigationEffect,
  scenarioOperationPrecedesAssertion,
  scenarioRoute,
} from '../../src/scenario-navigation';

const beforeUrl = 'https://example.test/app/#/workbench';
const afterUrl = 'https://example.test/app/#/orders?run=recorded';
function operation(type: 'click' | 'navigation', url: string): ScenarioRunStep {
  return {
    id: type,
    type: 'playwright-operation',
    description: type,
    event: {
      type,
      url,
      hashId: type,
      timestamp: 1,
      pageInfo: { width: 900, height: 600 },
    },
  };
}
function observation(): ScenarioRunStep {
  const step = operation('navigation', afterUrl);
  step.event!.actionType = 'Navigate';
  step.event!.rawPayload = {
    implicitNavigationState: true,
    triggerActionType: 'SessionNavigation',
    beforeUrl,
    afterUrl,
  };
  return step;
}

describe('recorded navigation effects', () => {
  test('observes the triggering click across passive route records, but not across real actions', () => {
    const click = operation('click', beforeUrl);
    const assertion: ScenarioRunStep = {
      id: 'assert',
      type: 'agent-assertion',
      description: '退出登录成功',
      instruction: '退出登录成功',
    };
    const route = observation();
    const changed = observation();
    changed.event!.actionType = 'NavigationChanged';
    changed.event!.rawPayload = undefined;
    const steps = [click, route, changed, assertion];
    expect(scenarioOperationPrecedesAssertion(steps, 0)).toBe(true);
    expect(scenarioOperationPrecedesAssertion(steps, 1)).toBe(false);
    expect(scenarioOperationPrecedesAssertion(steps, 2)).toBe(false);
    expect(scenarioOperationPrecedesAssertion(steps, 3)).toBe(false);
    for (const action of [
      'Navigate',
      'InitialNavigation',
      'GoBack',
      'GoForward',
      'Reload',
    ]) {
      const active = operation('navigation', afterUrl);
      active.event!.actionType = action;
      expect(isScenarioNavigationObservation(active)).toBe(false);
      expect(
        scenarioOperationPrecedesAssertion([click, active, assertion], 0),
      ).toBe(false);
      expect(
        scenarioOperationPrecedesAssertion([click, active, assertion], 1),
      ).toBe(true);
    }
    expect(scenarioOperationPrecedesAssertion([click, route], 0)).toBe(false);
  });
  test('an early session route belongs only to the menu item, not the preceding menu expansion', () => {
    const steps = [
      operation('click', beforeUrl),
      observation(),
      operation('click', beforeUrl),
    ];
    expect(scenarioNavigationEffect(steps, 0)).toBeUndefined();
    expect(scenarioNavigationEffect(steps, 2)).toEqual({
      beforeUrl,
      afterUrl,
      observationStepId: 'navigation',
    });
  });

  test('a click captured on the destination does not steal the preceding route change', () => {
    const steps = [
      operation('click', beforeUrl),
      observation(),
      operation('click', afterUrl),
    ];
    expect(scenarioNavigationEffect(steps, 0)?.afterUrl).toBe(afterUrl);
    expect(scenarioNavigationEffect(steps, 2)).toBeUndefined();
  });

  test('associates an early session observation with the action captured on its before URL', () => {
    expect(
      scenarioNavigationEffect(
        [observation(), operation('click', beforeUrl)],
        1,
      ),
    ).toEqual({ beforeUrl, afterUrl, observationStepId: 'navigation' });
  });

  test('associates an ordinary after-action observation', () => {
    const navigation = observation();
    navigation.event!.rawPayload!.triggerActionType = 'Tap';
    expect(
      scenarioNavigationEffect([operation('click', beforeUrl), navigation], 0)
        ?.afterUrl,
    ).toBe(afterUrl);
    expect(
      scenarioNavigationEffect([navigation, operation('click', beforeUrl)], 1),
    ).toBeUndefined();
  });

  test('a historical URL, a different before URL and an assertion boundary do not imply effects', () => {
    const historical = operation('navigation', afterUrl);
    historical.event!.actionType = 'NavigationChanged';
    expect(
      scenarioNavigationEffect([historical, operation('click', beforeUrl)], 1),
    ).toBeUndefined();
    expect(
      scenarioNavigationEffect(
        [observation(), operation('click', afterUrl)],
        1,
      ),
    ).toBeUndefined();
    expect(
      scenarioNavigationEffect(
        [
          observation(),
          {
            id: 'check',
            type: 'agent-assertion',
            description: 'Check',
            instruction: 'Check',
          },
          operation('click', beforeUrl),
        ],
        2,
      ),
    ).toBeUndefined();
  });

  test('route comparison preserves SPA paths and excludes credentials and query values', () => {
    expect(
      scenarioRoute(
        'https://user:secret@example.test/app/?token=secret#/orders?run=secret',
      ),
    ).toBe('https://example.test/app/#/orders');
    expect(scenarioRoute('https://example.test/app/#/workbench')).not.toBe(
      scenarioRoute(afterUrl),
    );
    const navigation = observation();
    navigation.event!.rawPayload!.afterUrl = `${beforeUrl}?run=next`;
    navigation.event!.url = `${beforeUrl}?run=next`;
    expect(
      scenarioNavigationEffect([operation('click', beforeUrl), navigation], 0),
    ).toBeUndefined();
  });
});
