import { ConfigProvider } from 'antd';
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioScenarios } from '../src/renderer/components/StudioScenarios';
import {
  SCENARIOS_STORAGE_KEY,
  loadStudioScenarios,
} from '../src/renderer/components/StudioScenarios/storage';
import { StudioWorkspace } from '../src/renderer/components/StudioWorkspace';
import type {
  StudioWorkbenchMenu,
  StudioWorkspaceMode,
} from '../src/renderer/components/StudioWorkspace/preferences';
import { setStudioLanguage } from '../src/renderer/i18n';
import { StudioModeTab } from '../src/renderer/recorder/types';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

async function render(active = true) {
  await act(async () =>
    root.render(
      createElement(
        ConfigProvider,
        { theme: { token: { motion: false } } },
        createElement(StudioScenarios, { active }),
      ),
    ),
  );
}
function button(label: string, scope: ParentNode = document) {
  const found = Array.from(
    scope.querySelectorAll<HTMLButtonElement>('button'),
  ).find(
    (item) =>
      item.textContent?.replace(/\s/g, '') === label.replace(/\s/g, '') ||
      item.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string, scope: ParentNode = document) {
  await act(async () => {
    button(label, scope).click();
  });
}
async function fill(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  )!;
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function create(name = 'Login', description = 'User login') {
  await click('New scenario', container);
  await fill('Scenario name', name);
  await fill('Scenario description (optional)', description);
  await click('Save');
}
async function menu(action: string) {
  await click('Scenario actions', container);
  await click(action, document.querySelector('[role="menu"]')!);
}

beforeEach(() => {
  localStorage.clear();
  setStudioLanguage('en');
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  localStorage.clear();
  setStudioLanguage('en');
});

describe('local scenario management', () => {
  it('focuses the name field and saves once when Enter is pressed', async () => {
    await render();
    await click('New scenario');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Scenario name"]',
    )!;
    expect(document.activeElement).toBe(input);
    await fill('Scenario name', 'Enter once');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(loadStudioScenarios()).toHaveLength(1);
  });

  it('keeps the editor open when Enter confirms an IME composition', async () => {
    await render();
    await click('New scenario');
    await fill('Scenario name', '登录场景');
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Scenario name"]',
    )!;
    const write = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(write).not.toHaveBeenCalled();
    expect(loadStudioScenarios()).toEqual([]);
    expect(input.value).toBe('登录场景');
    expect(
      document.querySelector<HTMLElement>('.ant-modal-wrap')?.style.display,
    ).toBe('');
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          isComposing: false,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(loadStudioScenarios()[0].name).toBe('登录场景');
  });

  it('creates trimmed fields, opens empty script details, returns, and persists after remount', async () => {
    await render();
    expect(container.textContent).toContain('No scenarios yet');
    await create(' Login ', ' User login ');
    expect(loadStudioScenarios()[0]).toMatchObject({
      name: 'Login',
      description: 'User login',
    });
    expect(container.querySelector('.studio-scenario-name')?.textContent).toBe(
      'Login',
    );
    await click('LoginUser login', container);
    expect(container.textContent).toContain('No scripts yet');
    expect(
      container.querySelector('.studio-scenario-detail h3')?.textContent,
    ).toBe('Login');
    const detail = container.querySelector('.studio-scenario-detail')!;
    expect(
      detail.querySelector('.studio-scenario-panel-body')?.textContent,
    ).toContain('No scripts yet');
    expect(button('Record new script', detail).disabled).toBe(true);
    const back = button('Back to scenarios', detail);
    expect(back.textContent).toBe('');
    expect(back.title).toBe('Back to scenarios');
    const detailActions = button('Scenario actions', detail);
    expect(detailActions.disabled).toBe(true);
    await act(async () => detailActions.click());
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await click('Back to scenarios', container);
    expect(container.querySelector('.studio-scenario-list')).not.toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.querySelector('.studio-scenario-name')?.textContent).toBe(
      'Login',
    );
    expect(container.querySelector('.studio-scenario-detail')).toBeNull();
  });

  it('rejects whitespace names, supports optional description and cancels creation', async () => {
    await render();
    await click('New scenario');
    await fill('Scenario name', '   ');
    await click('Save');
    expect(document.body.textContent).toContain(
      'Please enter a scenario name.',
    );
    expect(loadStudioScenarios()).toEqual([]);
    await click('Cancel');
    expect(container.textContent).toContain('No scenarios yet');
    await create('Optional', '');
    expect(loadStudioScenarios()[0].description).toBe('');
  });

  it('edits from the list menu, cancels changes, and opens updated details', async () => {
    await render();
    await create();
    const initial = loadStudioScenarios()[0];
    await menu('Edit scenario');
    expect(container.querySelector('.studio-scenario-detail')).toBeNull();
    await fill('Scenario name', 'Discard');
    await click('Cancel');
    expect(loadStudioScenarios()[0].name).toBe('Login');
    await click('LoginUser login', container);
    await click('Back to scenarios', container);
    await menu('Edit scenario');
    vi.spyOn(Date, 'now').mockReturnValue(initial.updatedAt - 100);
    await fill('Scenario name', 'Updated');
    await fill('Scenario description (optional)', 'Updated intro');
    await click('Save');
    expect(container.querySelector('.studio-scenario-detail')).toBeNull();
    await click('UpdatedUpdated intro', container);
    expect(
      container.querySelector('.studio-scenario-detail h3')?.textContent,
    ).toBe('Updated');
    expect(loadStudioScenarios()[0]).toMatchObject({
      id: initial.id,
      createdAt: initial.createdAt,
      name: 'Updated',
      description: 'Updated intro',
    });
    expect(loadStudioScenarios()[0].updatedAt).toBeGreaterThanOrEqual(
      initial.updatedAt,
    );
  });

  it('cancels list deletion, returns from details, and deletes from the list', async () => {
    await render();
    await create();
    await menu('Delete scenario');
    expect(container.querySelector('.studio-scenario-detail')).toBeNull();
    expect(
      document.querySelector('.studio-scenario-delete-name')?.textContent,
    ).toBe('Login');
    await click('Cancel');
    expect(loadStudioScenarios()).toHaveLength(1);
    await click('LoginUser login', container);
    await click('Back to scenarios', container);
    await menu('Delete scenario');
    await click('Delete');
    expect(loadStudioScenarios()).toEqual([]);
    expect(container.querySelector('.studio-scenario-detail')).toBeNull();
    expect(container.textContent).toContain('No scenarios yet');
  });

  it('preserves details and unsaved editor fields when the panel is hidden and shown', async () => {
    await render();
    await create();
    await click('LoginUser login', container);
    const heading = container.querySelector('.studio-scenario-detail h3');
    await render(false);
    await render(true);
    expect(container.querySelector('.studio-scenario-detail h3')).toBe(heading);
    await click('Back to scenarios', container);
    await menu('Edit scenario');
    await fill('Scenario name', 'Unsaved draft');
    await render(false);
    expect(
      container.querySelector<HTMLElement>('.studio-scenarios')?.style.display,
    ).toBe('none');
    await render(true);
    expect(container.querySelector('.studio-scenario-detail')).toBeNull();
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Scenario name"]')
        ?.value,
    ).toBe('Unsaved draft');
    expect(loadStudioScenarios()[0].name).toBe('Login');
  });

  it('keeps scenario details and drafts across the original mode and execution records menu', async () => {
    async function workspace(
      mode: StudioWorkspaceMode,
      menu: StudioWorkbenchMenu = 'scenarios',
    ) {
      await act(async () =>
        root.render(
          createElement(
            ConfigProvider,
            { theme: { token: { motion: false } } },
            <StudioWorkspace
              mode={mode}
              menu={menu}
              originalMode={StudioModeTab.Record}
            >
              <textarea
                aria-label="Original draft"
                defaultValue="Original state"
              />
            </StudioWorkspace>,
          ),
        ),
      );
    }
    await workspace('workbench');
    await create();
    await click('LoginUser login', container);
    const selected = container.querySelector('.studio-scenario-detail h3');
    const originalDraft = container.querySelector(
      'textarea[aria-label="Original draft"]',
    );
    await workspace('original');
    await workspace('workbench', 'execution-records');
    await workspace('workbench');
    expect(container.querySelector('.studio-scenario-detail h3')).toBe(
      selected,
    );
    await click('Back to scenarios', container);
    await menu('Edit scenario');
    await fill('Scenario name', 'Draft across tabs');
    await workspace('original');
    await workspace('workbench', 'execution-records');
    expect(container.textContent).toContain('No execution records yet');
    await workspace('workbench');
    expect(container.querySelector('.studio-scenario-detail')).toBeNull();
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Scenario name"]')
        ?.value,
    ).toBe('Draft across tabs');
    expect(
      container.querySelector('textarea[aria-label="Original draft"]'),
    ).toBe(originalDraft);
  });

  it('does not pretend creation or deletion succeeded when storage is full', async () => {
    await render();
    await create();
    const before = localStorage.getItem(SCENARIOS_STORAGE_KEY);
    const failure = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
    await create('Cannot save');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'Local storage is full. Unable to save.',
    );
    expect(container.querySelectorAll('.studio-scenario-row')).toHaveLength(1);
    expect(localStorage.getItem(SCENARIOS_STORAGE_KEY)).toBe(before);
    await click('Cancel');
    await menu('Delete scenario');
    await click('Delete');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'Local storage is full. Unable to save.',
    );
    expect(container.querySelectorAll('.studio-scenario-row')).toHaveLength(1);
    expect(localStorage.getItem(SCENARIOS_STORAGE_KEY)).toBe(before);
    failure.mockRestore();
    await click('Delete');
    expect(container.querySelectorAll('.studio-scenario-row')).toHaveLength(0);
  });

  it('shows the Chinese form and field length limits', async () => {
    setStudioLanguage('zh');
    await render();
    await click('新建场景');
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="场景名称"]')
        ?.maxLength,
    ).toBe(80);
    expect(
      document.querySelector<HTMLTextAreaElement>(
        '[aria-label="场景介绍（选填）"]',
      )?.maxLength,
    ).toBe(500);
    expect(document.body.textContent).toContain('场景介绍（选填）');
    await click('取消');
  });
});
