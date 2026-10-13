import { describe, expect, test } from '@rstest/core';
import type { ScenarioRunStep } from '../../src/scenario-contract';
import {
  scenarioNavigationEffect,
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
