import { expect, test } from '@rstest/core';
import type {
  ScenarioRunState,
  ScenarioRunStep,
} from '../../src/scenario-contract';
import {
  ScenarioEvidence,
  endsNativeEvidenceBlock,
} from '../../src/scenario-evidence';

const step = (id: string, type = 'input'): ScenarioRunStep => ({
  id,
  type: 'playwright-operation',
  description: id,
  event: {
    hashId: id,
    type,
    timestamp: 1,
    value: type === 'keydown' ? 'a' : id,
    nativeTarget: { locator: { selector: '#name' }, editable: true },
    pageInfo: { width: 900, height: 600 },
  } as any,
});

test('slow edits preserve a final field screenshot before the separate submit screenshot', async () => {
  const steps = Array.from({ length: 80 }, (_, i) =>
    step(`input-${i}`, i % 3 ? 'input' : 'keydown'),
  );
  steps.push(step('submit', 'click'));
  steps.push({
    id: 'assert',
    type: 'agent-assertion',
    description: '提交成功',
    instruction: '提交成功',
  });
  const run = {
    scripts: [{ name: '表单', steps }],
  } as unknown as ScenarioRunState;
  const evidence = new ScenarioEvidence('', run);
  const recorded: string[] = [];
  const agent = {
    recordToReport: async (title: string) => {
      recorded.push(title);
    },
  } as any;
  for (let i = 0; i < steps.length; i++) {
    evidence.setStep(steps[i], 0, i);
    if (endsNativeEvidenceBlock(steps, i))
      await evidence.recordNativeOutcome(agent, steps[i], 0);
  }
  expect(recorded).toEqual(['操作结果 / input-79', '操作结果 / submit']);
});

test('changing field, clicking, submitting, asserting and ending a script each finish input evidence', () => {
  const input = step('Super');
  const sameField = step('Superman');
  expect(endsNativeEvidenceBlock([input, sameField], 0)).toBe(false);
  const anotherField = step('password');
  anotherField.event!.nativeTarget!.locator = { selector: '#password' };
  const enter = step('submit', 'keydown');
  enter.event!.value = 'Enter';
  for (const next of [
    anotherField,
    step('button', 'click'),
    enter,
    {
      id: 'check',
      type: 'agent-assertion',
      description: '检查',
    } as ScenarioRunStep,
  ]) {
    expect(endsNativeEvidenceBlock([input, next], 0)).toBe(true);
  }
  expect(endsNativeEvidenceBlock([input], 0)).toBe(true);
  expect(endsNativeEvidenceBlock([step('click', 'click'), input], 0)).toBe(
    true,
  );
});

test('case switches, selection, clipboard edits and IME remain in the same field evidence', () => {
  const keys = [
    'CapsLock',
    'Shift',
    'Shift+A',
    'Shift++',
    'Shift+ArrowLeft',
    'Control+Shift+ArrowRight',
    'Meta+Shift+Home',
    'Control+Backspace',
    'Control+A',
    'Control+V',
    'Meta+Shift+Z',
    'Process',
  ];
  const first = step('S');
  for (const key of keys) {
    const edit = step(key, 'keydown');
    edit.event!.value = key;
    expect(endsNativeEvidenceBlock([first, edit], 0)).toBe(false);
    expect(endsNativeEvidenceBlock([edit, step('Super')], 0)).toBe(false);
    expect(endsNativeEvidenceBlock([edit], 0)).toBe(true);

    edit.event!.nativeTarget!.editable = false;
    expect(endsNativeEvidenceBlock([first, edit], 0)).toBe(true);
  }
});

test('submit, focus, dropdown and business shortcuts still end a field input block', () => {
  for (const key of [
    'Enter',
    'Shift+Enter',
    'Control+Enter',
    'Tab',
    'Shift+Tab',
    'Escape',
    'ArrowDown',
    'Alt+ArrowLeft',
    'Control+S',
    'F2',
  ]) {
    const next = step(key, 'keydown');
    next.event!.value = key;
    expect(endsNativeEvidenceBlock([step('Super'), next], 0)).toBe(true);
  }
  const otherPage = step('same field on another page');
  otherPage.event!.url = 'https://test.local/another-form';
  expect(endsNativeEvidenceBlock([step('Super'), otherPage], 0)).toBe(true);
  const unknown = step('unresolved field');
  unknown.event!.nativeTarget!.locator = undefined;
  expect(endsNativeEvidenceBlock([step('Super'), unknown], 0)).toBe(true);
});

test('a trailing case switch retains the input description and links all edits to one result', async () => {
  const input = step('Super');
  const caps = step('CapsLock', 'keydown');
  caps.event!.value = 'CapsLock';
  const steps = [input, caps];
  const run = {
    scripts: [{ name: '表单', steps }],
  } as unknown as ScenarioRunState;
  const evidence = new ScenarioEvidence('', run);
  const recorded: string[] = [];
  const agent = {
    recordToReport: async (title: string) => recorded.push(title),
  } as any;
  for (let i = 0; i < steps.length; i++) {
    evidence.setStep(steps[i], 0, i);
    if (endsNativeEvidenceBlock(steps, i))
      await evidence.recordNativeOutcome(agent, steps[i], 0);
  }
  expect(recorded).toEqual(['操作结果 / Super']);
});

test('active navigation, script end and checkpoints are boundaries; passive URL notifications are not additional captures', () => {
  const click = step('save', 'click');
  click.event!.url = 'https://test.local/form';
  const route = step('route', 'navigation');
  Object.assign(route.event!, {
    url: 'https://test.local/done',
    actionType: 'NavigationChanged',
    rawPayload: {
      beforeUrl: click.event!.url,
      afterUrl: 'https://test.local/done',
    },
  });
  const input = step('input');
  expect(endsNativeEvidenceBlock([click, route, input], 0)).toBe(true);
  expect(endsNativeEvidenceBlock([click, route, input], 1)).toBe(false);
  expect(endsNativeEvidenceBlock([click, route, input], 2)).toBe(true);
});
