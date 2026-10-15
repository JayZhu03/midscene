// @vitest-environment jsdom
import type { ScenarioRunInput, ScenarioRunState } from '@midscene/playground';
import { ConfigProvider } from 'antd';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudioScenarioScripts } from '../src/renderer/components/StudioScenarios/StudioScenarioScripts';
import {
  agentStepInstruction,
  agentTaskStep,
  compileScenarioScript,
  createAgentStep,
  editScenarioScript,
} from '../src/renderer/components/StudioScenarios/script-model';
import { setStudioLanguage } from '../src/renderer/i18n';
import { scenarioEvent, scenarioSession } from './fixtures/scenario-script';

const execution = vi.hoisted(() => ({
  run: null as ScenarioRunState | null,
  error: null as string | null,
  pending: false,
  ready: true,
  canStart: true,
  locked: false,
  isolatedSession: false,
  restoreSession: vi.fn(),
  start: vi.fn(),
  next: vi.fn(),
  skip: vi.fn(),
  stop: vi.fn(),
}));
const persistence = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }));
const compiler = vi.hoisted(() => ({ compile: vi.fn() }));
vi.mock(
  '../src/renderer/components/StudioScenarios/agent-tasks',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../src/renderer/components/StudioScenarios/agent-tasks')
    >()),
    compileStudioAgentPlan: compiler.compile,
  }),
);
vi.mock(
  '../src/renderer/components/StudioScenarios/useScenarioExecution',
  () => ({ useScenarioExecution: () => execution }),
);
vi.mock('../src/renderer/components/StudioScenarios/script-storage', () => ({
  listScenarioScripts: persistence.list,
  updateScenarioScriptSteps: persistence.update,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const scenario = {
  id: 'scene',
  name: 'Order flow',
  description: '',
  createdAt: 1,
  updatedAt: 1,
};
async function render() {
  await act(async () =>
    root.render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <StudioScenarioScripts scenario={scenario} active onBack={vi.fn()} />
      </ConfigProvider>,
    ),
  );
}
async function click(label: string) {
  const button = Array.from(
    document.querySelectorAll<HTMLElement>('button,[role="menuitem"]'),
  ).find(
    (item) =>
      !item.closest('.ant-dropdown-hidden') &&
      (item.getAttribute('aria-label') === label || item.textContent === label),
  );
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}
beforeEach(() => {
  localStorage.clear();
  setStudioLanguage('en');
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  execution.run = null;
  execution.error = null;
  execution.locked = false;
  execution.isolatedSession = false;
  execution.restoreSession.mockReset();
  persistence.update
    .mockReset()
    .mockImplementation(async (script, steps) =>
      editScenarioScript(script, steps),
    );
  compiler.compile
    .mockReset()
    .mockImplementation(async (instruction: string, readOnly: boolean) => ({
      version: 1,
      instruction,
      readOnly,
      actions: [
        {
          type: /打开|Open/.test(instruction) ? 'operation' : 'assertion',
          instruction,
          onFailure: 'stop',
        },
      ],
    }));
  execution.start
    .mockReset()
    .mockImplementation(async (plan: ScenarioRunInput) => {
      execution.locked = true;
      execution.run = {
        id: 'run-1',
        scenarioId: plan.scenarioId,
        scenarioName: plan.scenarioName,
        scope: plan.scope,
        sessionMode: plan.sessionMode,
        status: 'running',
        scriptIndex: 0,
        stepIndex: 0,
        scripts: plan.scripts.map((s, i) => ({
          id: s.id,
          name: s.name,
          status: i === 0 ? 'running' : 'pending',
          completedSteps: 0,
          totalSteps: s.steps.length,
          steps: s.steps.map((step, j) => ({
            id: step.id,
            description: step.description,
            type: step.type,
            status: i === 0 && j === 0 ? 'running' : 'pending',
          })),
        })),
      };
    });
  persistence.list.mockResolvedValue(
    ['a', 'b'].map((id) =>
      compileScenarioScript({
        id,
        scenarioId: 'scene',
        name: `Script ${id}`,
        session: scenarioSession(),
      }),
    ),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

async function typeInstruction(value: string) {
  const field = document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Step instruction"]',
  )!;
  expect(field).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('shows skip beside next only while waiting and labels skipped coverage honestly', async () => {
  await render();
  await click('Scenario actions');
  await click('Run scenario');
  expect(container.textContent).not.toContain('Skip');
  const run = execution.run!;
  run.status = 'waiting';
  run.scriptIndex = 1;
  run.scripts[0].status = 'passed';
  run.scripts[0].steps!.forEach((step) => {
    step.status = 'passed';
  });
  run.scripts[1].status = 'waiting';
  await render();
  const buttons = Array.from(
    container.querySelectorAll('.studio-execution-progress button'),
  );
  expect(buttons.map((button) => button.textContent)).toEqual([
    'Next step',
    'Skip',
    'Stop',
  ]);
  await click('Skip');
  expect(execution.skip).toHaveBeenCalledTimes(1);
  run.status = 'completed';
  run.scripts[1].status = 'skipped';
  run.scripts[1].steps!.forEach((step) => {
    step.status = 'skipped';
  });
  execution.locked = false;
  await render();
  const header = container.querySelector('.studio-execution-progress')!;
  expect(header.textContent).toContain('Completed · Some skipped');
  expect(header.textContent).not.toContain('All passed');
  expect(header.textContent).toContain('Skipped 1');
  expect(
    header.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),
  ).toBe(
    header.querySelector('[role="progressbar"]')?.getAttribute('aria-valuemax'),
  );
});

it.each([
  ['running', 'running', 'Running'],
  ['failed', 'passed', 'Completed · Some failures'],
  ['failed', 'pending', 'Execution interrupted'],
  ['blocked', 'blocked', 'Execution blocked'],
  ['stopped', 'pending', 'Stopped'],
] as const)(
  'separates test failure from execution lifecycle: %s / %s',
  async (status, secondStatus, label) => {
    await render();
    await click('Scenario actions');
    await click('Run scenario');
    const run = execution.run!;
    run.status = status;
    run.scripts[0].status = 'failed';
    run.scripts[0].steps![0].status = 'failed';
    run.scripts[1].status = secondStatus;
    execution.locked = status === 'running';
    await render();
    const header = container.querySelector('.studio-execution-progress')!;
    expect(header.querySelector('.studio-execution-state')?.textContent).toBe(
      label,
    );
    expect(
      header.querySelector('.studio-execution-counts')?.textContent,
    ).toContain('Failed 1');
    if (secondStatus === 'passed') {
      expect(header.textContent).toContain('Passed 1');
      expect(header.querySelector('.ant-progress-status-exception')).toBeNull();
      expect(
        header.querySelector<HTMLElement>('.ant-progress-bg')?.style.background,
      ).toContain('--midscene-status-warning');
    }
    if (status === 'blocked')
      expect(
        header.querySelector('.ant-progress-status-exception'),
      ).toBeTruthy();
    if (secondStatus === 'pending')
      expect(header.textContent).toContain('Not executed 1');
  },
);

it('shows recovery progress, preserves its evidence, and distinguishes blocked from unexecuted', async () => {
  await render();
  await click('Scenario actions');
  await click('Run scenario');
  const run = execution.run!;
  const step = run.scripts[0].steps![0];
  run.phase = 'recovering';
  step.recovery = {
    status: 'running',
    originalError: 'Target moved',
    startedAt: 1,
  };
  await render();
  expect(container.textContent).toContain('Agent taking over');
  step.status = 'passed';
  step.recovery.status = 'recovered';
  step.recovery.reason = 'Saved order is visible';
  run.phase = undefined;
  run.status = 'blocked';
  run.scripts[0].status = 'failed';
  run.scripts[1].status = 'blocked';
  run.scripts[1].continuation = {
    status: 'blocked',
    reason: 'Required order was not created',
  };
  execution.locked = false;
  await render();
  expect(container.textContent).toContain('Passed · Agent recovery');
  expect(container.textContent).toContain('Target moved');
  expect(container.textContent).toContain('Saved order is visible');
  expect(container.textContent).toContain('Required order was not created');
  expect(container.textContent).toContain('Blocked');
  expect(container.textContent).toContain('Not executed');
  expect(
    container.querySelector('.studio-execution-recovery')?.hasAttribute('open'),
  ).toBe(false);
  expect(
    container
      .querySelector('[role="progressbar"]')
      ?.getAttribute('aria-valuenow'),
  ).toBe('1');
});

it('edits the original step timeline and keeps execution results read-only', async () => {
  await render();
  await click('Script actions');
  await click('Edit script');
  expect(
    container.querySelectorAll('.record-timeline-event-card'),
  ).toHaveLength(1);
  expect(container.querySelector('textarea')).toBeNull();
  expect(container.querySelector('[aria-label="Step actions 1"]')).toBeNull();
  await click('Insert step 2');
  expect(container.querySelector('textarea')).toBeNull();
  expect(
    container.querySelectorAll('.record-timeline-event-card'),
  ).toHaveLength(1);
  await click('Add operation or assertion');
  expect(
    container.querySelector<HTMLButtonElement>(
      '.studio-script-editor-footer .ant-btn-primary',
    )!.disabled,
  ).toBe(true);
  await typeInstruction('Order quantity is 20');
  await click('Save changes');
  expect(persistence.update).toHaveBeenCalledTimes(1);
  expect(execution.start).not.toHaveBeenCalled();
  await click('Back to scenario');
  await click('Script actions');
  await click('Run this script');
  expect(execution.start.mock.calls[0][0].scripts[0].steps[1].instruction).toBe(
    'Order quantity is 20',
  );
  execution.run!.status = 'completed';
  execution.locked = false;
  await render();
  expect(container.querySelector('[aria-label^="Edit step"]')).toBeNull();
  expect(container.querySelector('[aria-label^="Step actions"]')).toBeNull();
  await click('Back to scenario');
  await click('Script a');
  await click('Step actions 2');
  await click('Edit step');
  await typeInstruction('Order quantity is 30');
  await click('Save changes');
  await click('View execution · Completed');
  expect(container.querySelector('.studio-execution-page')).toBeTruthy();
  expect(container.textContent).toContain('Order quantity is 20');
  expect(container.textContent).not.toContain('Order quantity is 30');
  expect(persistence.update.mock.calls[1][1][1].instruction).toBe(
    'Order quantity is 30',
  );
});

it.each([1, 2])(
  'does not insert a step when the add menu at position %s is dismissed',
  async (position) => {
    await render();
    await click('Script a');
    await click(`Insert step ${position}`);
    expect(
      document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden)')
        ?.textContent,
    ).toBe('Add operation or assertion');
    expect(container.querySelector('textarea')).toBeNull();
    expect(
      container.querySelectorAll('.record-timeline-event-card'),
    ).toHaveLength(1);
    await click(`Insert step ${position}`);
    expect(container.querySelector('.studio-script-editor-footer')).toBeNull();
    await click('Back to scenario');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(persistence.update).not.toHaveBeenCalled();
    expect(compiler.compile).not.toHaveBeenCalled();
  },
);

it('opens the same editable timeline from a row and leaves unchanged details without a discard prompt', async () => {
  await render();
  await act(async () =>
    container.querySelector<HTMLElement>('.studio-sequence-node')!.click(),
  );
  expect(container.querySelector('.record-timeline-event-card')).toBeTruthy();
  expect(container.querySelector('[aria-label="Insert step 1"]')).toBeTruthy();
  expect(container.querySelector('.studio-script-editor-footer')).toBeNull();
  await click('Back to scenario');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('Script a');
  await click('Insert step 1');
  await click('Add operation or assertion');
  await typeInstruction('Ready');
  await click('Back to scenario');
  await click('Keep editing');
  expect(container.querySelector('textarea')?.value).toBe('Ready');
  await click('Back to scenario');
  await click('Discard');
  expect(container.querySelector('.studio-sequence-row')).toBeTruthy();
  expect(persistence.update).not.toHaveBeenCalled();
});

it.each([
  ['agent-assertion', 'Backspace'],
  ['agent-assertion', 'Delete'],
  ['agent-operation', 'Backspace'],
  ['agent-operation', 'Delete'],
  ['agent-task', 'Backspace'],
  ['agent-task', 'Delete'],
] as const)(
  'keeps the %s editor open when %s restores saved text or clears the field',
  async (type, key) => {
    const instruction =
      type === 'agent-assertion' ? '订单数量为 20' : '打开生产订单页面';
    const original = compileScenarioScript({
      id: 'a',
      scenarioId: 'scene',
      name: 'Script a',
      session: scenarioSession(),
    });
    const saved = editScenarioScript(original, [
      ...original.steps,
      type === 'agent-task'
        ? agentTaskStep(createAgentStep(type), instruction, {
            version: 1,
            instruction,
            readOnly: false,
            actions: [{ type: 'operation', instruction }],
          })
        : agentStepInstruction(createAgentStep(type), instruction),
    ]);
    persistence.list.mockResolvedValueOnce([saved]);
    await render();
    await click('Script a');
    await click('Step actions 2');
    await click('Edit step');
    const field = container.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(document.activeElement).toBe(field);
    await typeInstruction(`${instruction}错`);
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
    // jsdom does not apply keyboard edits, so dispatch the resulting input too.
    await typeInstruction(instruction);
    expect(container.querySelector('textarea')).toBe(field);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe(instruction);
    expect(
      container.querySelector<HTMLButtonElement>(
        '.studio-script-editor-footer .ant-btn-primary',
      )!.disabled,
    ).toBe(true);
    await click('Cancel');
    expect(container.querySelector('textarea')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(persistence.update).not.toHaveBeenCalled();
    expect(compiler.compile).not.toHaveBeenCalled();

    await click('Step actions 2');
    await click('Edit step');
    const reopened = container.querySelector<HTMLTextAreaElement>('textarea')!;
    await typeInstruction('');
    expect(container.querySelector('textarea')).toBe(reopened);
    expect(document.activeElement).toBe(reopened);
    expect(
      container.querySelector<HTMLButtonElement>(
        '.studio-script-editor-footer .ant-btn-primary',
      )!.disabled,
    ).toBe(true);
    await typeInstruction(`${instruction}，保持当前页面`);
    await click('Save changes');
    expect(container.querySelector('textarea')).toBeNull();
    expect(persistence.update).toHaveBeenCalledTimes(1);
    expect(persistence.update.mock.calls[0][1][0]).toEqual(original.steps[0]);
    expect(persistence.update.mock.calls[0][1][1].instruction).toBe(
      `${instruction}，保持当前页面`,
    );
  },
);

it('inserts between recorded steps without moving expanded details or losing screenshots', async () => {
  persistence.list.mockResolvedValueOnce([
    compileScenarioScript({
      id: 'a',
      scenarioId: 'scene',
      name: 'Script a',
      session: scenarioSession({
        events: [
          scenarioEvent(),
          scenarioEvent({
            hashId: 'event-2',
            screenshotAfter: 'https://example.com/after.png',
          }),
        ],
      }),
    }),
  ]);
  await render();
  await click('Script a');
  const second = container.querySelector<HTMLElement>(
    '[data-entry-id="event-2"]',
  )!;
  await act(async () =>
    second.querySelector<HTMLElement>('.record-timeline-event-card')!.click(),
  );
  expect(second.querySelector('pre')).toBeTruthy();
  await click('Insert step 2');
  await click('Add operation or assertion');
  await typeInstruction('Open order details');
  expect(
    container.querySelectorAll('.record-timeline-event-card'),
  ).toHaveLength(3);
  expect(container.querySelector('[data-entry-id="event-2"] pre')).toBeTruthy();
  expect(container.querySelector('[data-entry-id="event-1"] pre')).toBeNull();
  expect(container.querySelector('img')?.getAttribute('src')).toBe(
    'https://example.com/after.png',
  );
  await click('Save changes');
  expect(
    persistence.update.mock.calls[0][1].map(
      (step: { type: string }) => step.type,
    ),
  ).toEqual(['playwright-operation', 'agent-task', 'playwright-operation']);
});

it('retains the instruction when planning fails and saves its rules only after a successful retry', async () => {
  await render();
  await click('Script a');
  await click('Insert step 2');
  await click('Add operation or assertion');
  expect(container.querySelector('textarea')?.placeholder).toBe(
    'Describe an operation, expected result or wait',
  );
  await typeInstruction('数量不对也记录并继续');
  compiler.compile.mockRejectedValueOnce(new Error('模型连接失败'));
  await click('Save changes');
  expect(container.textContent).toContain('模型连接失败');
  expect(container.querySelector('textarea')?.value).toBe(
    '数量不对也记录并继续',
  );
  expect(persistence.update).not.toHaveBeenCalled();
  await click('Save changes');
  expect(persistence.update).toHaveBeenCalledTimes(1);
  expect(persistence.update.mock.calls[0][1][1]).toMatchObject({
    type: 'agent-task',
    agentPlan: { instruction: '数量不对也记录并继续' },
  });
  expect(container.querySelector('textarea')).toBeNull();
});

it('reuses prepared rules when saving is retried after a storage error', async () => {
  await render();
  await click('Script a');
  await click('Insert step 2');
  await click('Add operation or assertion');
  await typeInstruction('Order quantity is 20');
  persistence.update.mockRejectedValueOnce(
    new Error('Unable to update script.'),
  );
  await click('Save changes');
  expect(compiler.compile).toHaveBeenCalledTimes(1);
  expect(container.querySelector('textarea')?.value).toBe(
    'Order quantity is 20',
  );
  await click('Save changes');
  expect(compiler.compile).toHaveBeenCalledTimes(1);
  expect(persistence.update).toHaveBeenCalledTimes(2);
  expect(container.querySelector('textarea')).toBeNull();
});

it('keeps unsaved edits on storage failure, allows deletion and confirms discarding changes', async () => {
  await render();
  await click('Script actions');
  await click('Edit script');
  await click('Insert step 1');
  await click('Add operation or assertion');
  await typeInstruction('Open orders');
  persistence.update.mockRejectedValueOnce(
    new Error('Unable to update script.'),
  );
  await click('Save changes');
  expect(container.textContent).toContain('Unable to update script.');
  expect(container.querySelector('textarea')?.value).toBe('Open orders');
  await click('Step actions 1');
  await click('Delete');
  expect(
    container.querySelectorAll('.record-timeline-event-card'),
  ).toHaveLength(1);
  await click('Insert step 2');
  await click('Add operation or assertion');
  await typeInstruction('Ready');
  await click('Cancel');
  await click('Keep editing');
  expect(container.querySelector('textarea')?.value).toBe('Ready');
  await click('Cancel');
  await click('Discard');
  expect(container.querySelector('.studio-script-editor-footer')).toBeNull();
  expect(container.querySelector('.record-timeline-event-card')).toBeTruthy();
  expect(persistence.update).toHaveBeenCalledTimes(1);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it.each(['scenario', 'script'] as const)(
  'opens a dedicated execution page for %s and can return/reopen without restarting',
  async (scope) => {
    await render();
    await click(scope === 'scenario' ? 'Scenario actions' : 'Script actions');
    await click(scope === 'scenario' ? 'Run scenario' : 'Run this script');
    expect(execution.start).toHaveBeenCalledTimes(1);
    expect(execution.start.mock.calls[0][0].scope).toBe(scope);
    expect(execution.run!.scripts).toHaveLength(scope === 'scenario' ? 2 : 1);
    expect(container.querySelector('.studio-execution-page')).toBeTruthy();
    expect(container.textContent).not.toContain('Record new script');
    expect(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute('aria-valuenow'),
    ).toBe('0');
    await click('Back to scenario');
    expect(container.querySelector('.studio-execution-page')).toBeNull();
    await click('View execution · Running');
    expect(execution.start).toHaveBeenCalledTimes(1);
    execution.run!.status = 'failed';
    execution.run!.error = 'Wrong quantity';
    execution.run!.scripts[0].status = 'failed';
    execution.run!.summary = { status: 'failed' };
    execution.locked = false;
    await render();
    expect(container.textContent).toContain('Wrong quantity');
    await click('Back to scenario');
    expect(container.textContent).not.toContain('Wrong quantity');
    await click('View execution · Failed');
    expect(container.textContent).toContain('Wrong quantity');
    await click('View report');
    expect(document.body.textContent).toContain('Report generation failed');
    expect(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute('aria-valuenow'),
    ).toBe('0');
  },
);

it('shows checkpoint evidence and summary independently of execution status', async () => {
  await render();
  await click('Script actions');
  await click('Run this script');
  const run = execution.run!;
  run.status = 'completed';
  run.scripts[0].status = 'passed';
  run.scripts[0].completedSteps = run.scripts[0].totalSteps;
  run.scripts[0].steps![0].detail = 'Quantity matches';
  run.error = 'Quantity matches';
  run.summary = { status: 'generating' };
  await render();
  expect(container.querySelector('.studio-report-progress')).toBeNull();
  await click('View report');
  expect(document.body.textContent).toContain(
    'Report is being generated. Please wait.',
  );
  expect(container.textContent?.split('Quantity matches')).toHaveLength(2);
  expect(
    container.querySelector('.studio-execution-body > .studio-scenario-error'),
  ).toBeNull();
  expect(
    container.querySelector('.studio-execution-page > .studio-report-entry'),
  ).toBeTruthy();
  run.summary = {
    status: 'completed',
    text: 'Recorded checkpoints passed. Review business coverage.',
  };
  await render();
  expect(container.textContent).not.toContain(run.summary.text);
  await click('View report');
  expect(document.querySelector('iframe')?.getAttribute('srcdoc')).toContain(
    run.summary.text,
  );
  expect(container.textContent).toContain('Completed');
});

it('changes and persists execution mode without starting a run', async () => {
  await render();
  await click('Scenario actions');
  const submenu = document.querySelector<HTMLElement>(
    '.ant-dropdown-menu-submenu-title',
  )!;
  expect(submenu.textContent).toContain('Use current session');
  await act(async () => {
    submenu.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  await click('Fresh session');
  expect(execution.start).not.toHaveBeenCalled();
  expect(localStorage.getItem('studio.scenario-session.v1.scene')).toBe(
    'fresh',
  );
});

it.each(['scenario', 'script'] as const)(
  'uses the saved fresh mode for %s and offers restore after completion',
  async (scope) => {
    localStorage.setItem('studio.scenario-session.v1.scene', 'fresh');
    await render();
    await click(scope === 'scenario' ? 'Scenario actions' : 'Script actions');
    await click(scope === 'scenario' ? 'Run scenario' : 'Run this script');
    expect(execution.start.mock.calls[0][0].sessionMode).toBe('fresh');
    expect(container.textContent).toContain('Fresh session');
    execution.isolatedSession = true;
    await render();
    expect(container.textContent).not.toContain('Return to original session');
    execution.run!.status = 'completed';
    execution.locked = false;
    await render();
    await click('Return to original session');
    expect(execution.restoreSession).toHaveBeenCalledTimes(1);
  },
);
