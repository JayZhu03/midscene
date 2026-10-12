// @vitest-environment jsdom
import type { ScenarioRunInput, ScenarioRunState } from '@midscene/playground';
import { ConfigProvider } from 'antd';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudioScenarioScripts } from '../src/renderer/components/StudioScenarios/StudioScenarioScripts';
import { compileScenarioScript } from '../src/renderer/components/StudioScenarios/script-model';
import { setStudioLanguage } from '../src/renderer/i18n';
import { scenarioSession } from './fixtures/scenario-script';

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
  stop: vi.fn(),
}));
const persistence = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock(
  '../src/renderer/components/StudioScenarios/useScenarioExecution',
  () => ({ useScenarioExecution: () => execution }),
);
vi.mock('../src/renderer/components/StudioScenarios/script-storage', () => ({
  listScenarioScripts: persistence.list,
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
      item.getAttribute('aria-label') === label || item.textContent === label,
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
    expect(container.textContent).toContain(
      'AI summary unavailable. Execution results are retained.',
    );
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
  run.summary = { status: 'generating' };
  await render();
  expect(container.textContent).toContain('Generating summary…');
  expect(container.textContent).toContain('Quantity matches');
  run.summary = {
    status: 'completed',
    text: 'Recorded checkpoints passed. Review business coverage.',
  };
  await render();
  expect(container.textContent).toContain(run.summary.text);
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
