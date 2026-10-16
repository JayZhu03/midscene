import { describe, expect, test } from '@rstest/core';
import type { ScenarioRunStep } from '../../src/scenario-contract';
import {
  isScenarioNavigationObservation,
  sameScenarioPage,
  scenarioLiveNavigationTarget,
  scenarioNavigationEffect,
  scenarioNavigationExpectation,
  scenarioNavigationMatches,
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

  const recordedDetail =
    'https://example.test/app/#/object-detail/object-detail-1792131578759-56ydmi2o?from=%2Forders';
  const currentDetail =
    'https://example.test/app/#/object-detail/object-detail-1792134966120-9x684516?from=%2Forders';
  const detailEffect = () => ({
    beforeUrl: 'https://example.test/app/#/orders',
    afterUrl: recordedDetail,
    observationStepId: 'detail-open',
  });

  test('matches regenerated view tokens without changing the route log or the recorded URL', () => {
    const effect = detailEffect();
    expect(sameScenarioPage(recordedDetail, currentDetail)).toBe(true);
    expect(scenarioNavigationMatches(effect, currentDetail)).toBe(true);
    expect(scenarioNavigationExpectation(effect)).toMatchObject({
      expectedRoute:
        'https://example.test/app/#/object-detail/object-detail-:instance',
      sourceRoute: '/orders',
      transientInstance: true,
    });
    expect(scenarioRoute(recordedDetail)).toContain('1792131578759-56ydmi2o');
    expect(effect.afterUrl).toBe(recordedDetail);
    // Early session observations can be saved before the app appends `from`.
    expect(
      scenarioNavigationMatches(
        { ...effect, afterUrl: recordedDetail.split('?')[0] },
        currentDetail,
      ),
    ).toBe(true);
  });

  test('does not loosen static pages, business IDs, origins, source modules or unknown tokens', () => {
    for (const wrong of [
      currentDetail.replace('example.test', 'other.test'),
      currentDetail.replace('/app/', '/other-app/'),
      currentDetail.replace('#/object-detail/', '#/wrong-detail/'),
      currentDetail.replace(
        'object-detail-1792134966120',
        'task-detail-1792134966120',
      ),
      currentDetail.replace('from=%2Forders', 'from=%2Ftasks'),
      currentDetail.replace(
        'object-detail-1792134966120-9x684516',
        'unknown-token',
      ),
      'https://example.test/app/#/orders',
    ])
      expect(scenarioNavigationMatches(detailEffect(), wrong)).toBe(false);
    expect(sameScenarioPage('invalid', 'invalid')).toBe(false);
    expect(
      sameScenarioPage(
        'https://example.test/orders/123',
        'https://example.test/orders/456',
      ),
    ).toBe(false);
    expect(
      sameScenarioPage(
        'https://example.test/app/#/model-page/order',
        'https://example.test/app/#/model-page/task',
      ),
    ).toBe(false);
  });

  test('uses current-run transition evidence, including when opening detail B from detail A', () => {
    const effect = {
      ...detailEffect(),
      beforeUrl: recordedDetail,
      runtime: { beforeUrl: currentDetail },
    };
    expect(scenarioNavigationMatches(effect, currentDetail)).toBe(false);
    expect(
      scenarioNavigationMatches(
        effect,
        currentDetail.replace(
          '1792134966120-9x684516',
          '1792135078203-dd69itvz',
        ),
      ),
    ).toBe(true);
  });

  test('a live temporary link still requires the recorded source module', () => {
    const effect = {
      ...detailEffect(),
      runtime: { beforeUrl, targetUrl: currentDetail },
    };
    expect(scenarioNavigationMatches(effect, currentDetail)).toBe(true);
    expect(
      scenarioNavigationMatches(
        effect,
        currentDetail.replace('from=%2Forders', 'from=%2Ftasks'),
      ),
    ).toBe(false);
    expect(scenarioNavigationMatches(effect, currentDetail.split('?')[0])).toBe(
      false,
    );
    expect(
      scenarioLiveNavigationTarget(
        effect,
        currentDetail.replace('from=%2Forders', 'from=%2Ftasks'),
      ),
    ).toBeUndefined();
  });

  test('keeps source identity when its parent is another regenerated detail instance', () => {
    const nested = `${recordedDetail.split('?')[0]}?from=${encodeURIComponent('/object-detail/object-detail-1792131578759-56ydmi2o?from=%2Forders')}`;
    const live = `${currentDetail.split('?')[0]}?from=${encodeURIComponent('/object-detail/object-detail-1792134966120-9x684516?from=%2Forders')}`;
    expect(sameScenarioPage(nested, live)).toBe(true);
    expect(
      sameScenarioPage(nested, live.replace('%252Forders', '%252Ftasks')),
    ).toBe(false);
  });

  test.each([
    ['123', '456'],
    [
      '123e4567-e89b-12d3-a456-426614174000',
      '123e4567-e89b-12d3-a456-426614174001',
    ],
    ['d01a2b3c4d5e6f70', 'd01a2b3c4d5e6f71'],
  ])(
    'binds a changed %s data ID only to a current link with the same route structure',
    (recorded, current) => {
      const effect = {
        beforeUrl,
        afterUrl: `https://example.test/app/#/orders/${recorded}/detail`,
        observationStepId: 'open',
      };
      const href = `https://example.test/app/#/orders/${current}/detail`;
      expect(scenarioNavigationMatches(effect, href)).toBe(false);
      expect(scenarioLiveNavigationTarget(effect, href)).toBe(href);
      const runtime = { beforeUrl, targetUrl: href };
      expect(scenarioNavigationMatches({ ...effect, runtime }, href)).toBe(
        true,
      );
      expect(
        scenarioNavigationMatches({ ...effect, runtime }, effect.afterUrl),
      ).toBe(false);
      expect(
        scenarioLiveNavigationTarget(
          effect,
          href.replace('/orders/', '/tasks/'),
        ),
      ).toBeUndefined();
      expect(
        scenarioLiveNavigationTarget(effect, 'javascript:void(0)'),
      ).toBeUndefined();
    },
  );
});
