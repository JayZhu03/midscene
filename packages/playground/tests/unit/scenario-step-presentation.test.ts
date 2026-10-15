import { expect, test } from '@rstest/core';
import type { ScenarioRunStep } from '../../src/scenario-contract';
import { scenarioStepPresentation } from '../../src/scenario-step-presentation';

test('report labels use recorded semantics and labelled locators without retaining input values', () => {
  const step: ScenarioRunStep = {
    id: 'input',
    type: 'playwright-operation',
    description: 'Input into unresolved input field in the current visible UI',
    event: {
      type: 'input',
      hashId: 'input',
      timestamp: 1,
      pageInfo: { width: 1920, height: 1080 },
      title: '生产订单 - KMMOM CLOUD',
      url: 'https://test/orders',
      value: 'private-value',
      nativeTarget: {
        editable: true,
        locator: { selector: 'input[placeholder="订单编号"]' },
      },
    },
  };
  const info = scenarioStepPresentation(step);
  expect(info).toMatchObject({
    action: 'input',
    target: '订单编号',
    page: '生产订单',
    editable: true,
    contextOnly: false,
  });
  expect(JSON.stringify(info)).not.toContain('private-value');
  step.event!.semantic = {
    source: 'aiDescribe',
    status: 'ready',
    elementDescription: '生产订单编号输入框',
  };
  expect(scenarioStepPresentation(step)?.target).toBe('生产订单编号输入框');
  step.event!.semantic.elementDescription =
    'unresolved input field in the current visible UI';
  expect(scenarioStepPresentation(step)?.target).toBe('订单编号');
});

test('passive navigation is context while a real navigation remains an action', () => {
  const step: ScenarioRunStep = {
    id: 'nav',
    type: 'playwright-operation',
    description: 'Navigate',
    event: {
      type: 'navigation',
      hashId: 'nav',
      timestamp: 1,
      actionType: 'NavigationChanged',
      pageInfo: { width: 1920, height: 1080 },
    },
  };
  expect(scenarioStepPresentation(step)?.contextOnly).toBe(true);
  step.event!.actionType = 'Navigate';
  expect(scenarioStepPresentation(step)?.contextOnly).toBe(false);
  expect(
    scenarioStepPresentation({
      id: 'assert',
      type: 'agent-assertion',
      description: '订单可见',
    }),
  ).toBeUndefined();
});
