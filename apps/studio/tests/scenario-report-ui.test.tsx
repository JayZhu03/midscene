// @vitest-environment jsdom
import type { ScenarioRunState } from '@midscene/playground';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudioExecutionRecords } from '../src/renderer/components/StudioScenarios/StudioExecutionRecords';
import { StudioScenarioReport } from '../src/renderer/components/StudioScenarios/StudioScenarioReport';
import { setStudioLanguage } from '../src/renderer/i18n';
import { StudioPlaygroundContext } from '../src/renderer/playground/useStudioPlayground';

const save = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../src/renderer/recorder/export', () => ({
  saveStudioRecorderFile: save,
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
async function click(label: string) {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => button.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
let root: Root;
let container: HTMLDivElement;
const text =
  '# Test report\n\n## Findings\n\n| Result | Count |\n| --- | --- |\n| Failed | 1 |\n\n<script>bad()</script>\n\n![image](https://example.com/a.png)';
const run: ScenarioRunState = {
  id: 'run-12345678',
  scenarioId: 'scene',
  scenarioName: 'Orders',
  status: 'completed',
  scriptIndex: 0,
  stepIndex: 0,
  scripts: [],
  summary: { status: 'completed', format: 'markdown', text },
};
beforeEach(() => {
  setStudioLanguage('en');
  save.mockClear();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it('previews Markdown tables safely and downloads the exact saved text without an AI call', async () => {
  await act(async () => root.render(<StudioScenarioReport run={run} />));
  expect(container.querySelector('table')).toBeNull();
  await click('View report');
  expect(document.querySelector('h1')?.textContent).toBe('Test report');
  expect(document.querySelectorAll('table')).toHaveLength(1);
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
  await click('Download report');
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      content: text,
      defaultFileName: 'Orders-run-1234.md',
    }),
  );
});
it('keeps the report button clickable while generating and opens the report once ready', async () => {
  for (const phase of ['analyzing', 'repairing', 'saving'] as const) {
    await act(async () =>
      root.render(
        <StudioScenarioReport
          run={{ ...run, summary: { status: 'generating', phase } }}
        />,
      ),
    );
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(
      false,
    );
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    await click('View report');
    expect(document.body.textContent).toContain(
      'Report is being generated. Please wait.',
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  }
  await act(async () => root.render(<StudioScenarioReport run={run} />));
  await click('View report');
  expect(document.querySelector('[role="dialog"] table')).toBeTruthy();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.ant-drawer-close')!.click(),
  );
  expect(document.querySelector('.ant-drawer-open')).toBeNull();
  await click('View report');
  expect(document.querySelector('[role="dialog"] table')).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
});
it('reports generation failure instead of telling users to wait indefinitely', async () => {
  await act(async () =>
    root.render(
      <StudioScenarioReport run={{ ...run, summary: { status: 'failed' } }} />,
    ),
  );
  await click('View report');
  expect(document.body.textContent).toContain('Report generation failed');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('keeps the basic report downloadable after AI failure and surfaces export errors', async () => {
  save.mockRejectedValueOnce(new Error('Disk full'));
  await act(async () =>
    root.render(
      <StudioScenarioReport
        run={{ ...run, summary: { ...run.summary!, status: 'failed' } }}
      />,
    ),
  );
  await click('View report');
  expect(document.querySelector('table')).toBeTruthy();
  await click('Download report');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to download report',
  );
});
it('loads a saved report from execution records without starting or regenerating a run', async () => {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith('/scenario-reports')
        ? {
            reports: [
              {
                id: run.id,
                name: 'Orders',
                scope: 'script',
                scenarioName: 'MOM main flow',
                startedAt: 1000,
                finishedAt: 4000,
                status: 'completed',
                counts: {
                  passed: 1,
                  failed: 0,
                  blocked: 0,
                  pending: 0,
                  stopped: 0,
                },
                recoveryCount: 1,
              },
            ],
          }
        : { run },
  }));
  vi.stubGlobal('fetch', fetchMock);
  await act(async () =>
    root.render(
      <StudioPlaygroundContext.Provider
        value={{ phase: 'ready', serverUrl: 'http://localhost:1234' } as any}
      >
        <StudioExecutionRecords />
      </StudioPlaygroundContext.Provider>,
    ),
  );
  expect(container.querySelector('input')).toBeNull();
  expect(container.textContent).toContain(
    'Only the latest 10 execution records are retained. Download reports you want to keep.',
  );
  const refresh = container.querySelector<HTMLButtonElement>(
    '[aria-label="Refresh records"]',
  );
  expect(refresh?.disabled).toBe(false);
  await act(async () => refresh!.click());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('.studio-report-list button')!
      .click(),
  );
  expect(container.querySelector('.studio-execution-page')).toBeTruthy();
  expect(document.querySelector('table')).toBeNull();
  await click('View report');
  expect(document.querySelector('table')).toBeTruthy();
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    'http://localhost:1234/scenario-reports',
    'http://localhost:1234/scenario-reports',
    `http://localhost:1234/scenario-reports/${run.id}`,
  ]);
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.ant-drawer-close')!.click(),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Back to execution records"]',
      )!
      .click(),
  );
  expect(container.textContent).toContain('MOM main flow');
  expect(container.textContent).toContain('Agent recovery 1');
  expect(container.textContent).toContain('3.0 s');
});

it('shows the Chinese retention note without an execution-record search box', async () => {
  setStudioLanguage('zh');
  await act(async () => root.render(<StudioExecutionRecords />));
  expect(container.querySelector('input')).toBeNull();
  expect(container.textContent).toContain(
    '仅保留最近 10 次执行记录，请及时下载需要留存的报告。',
  );
});
