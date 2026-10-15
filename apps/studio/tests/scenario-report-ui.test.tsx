// @vitest-environment jsdom
import type { ScenarioRunState } from '@midscene/playground';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  isNativePreviewCovered,
  subscribeNativePreviewCover,
} from '../src/renderer/components/MainContent/native-preview-cover';
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
it('waits for native hiding before mounting the report, and releases on unmount', async () => {
  let acknowledge!: () => void;
  const unsubscribe = subscribeNativePreviewCover(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  );
  try {
    await act(async () => root.render(<StudioScenarioReport run={run} />));
    await click('View report');
    expect(isNativePreviewCovered()).toBe(true);
    expect(document.querySelector('iframe')).toBeNull();
    await act(async () => acknowledge());
    expect(document.querySelector('[role="dialog"] iframe')).toBeTruthy();
    await act(async () => root.render(null));
    expect(isNativePreviewCovered()).toBe(false);
    acknowledge();
  } finally {
    unsubscribe();
  }
});
it('previews an isolated HTML report and downloads HTML without an AI call', async () => {
  await act(async () => root.render(<StudioScenarioReport run={run} />));
  expect(container.querySelector('table')).toBeNull();
  await click('View report');
  expect(document.querySelector('iframe')?.getAttribute('sandbox')).toBe(
    'allow-scripts',
  );
  expect(document.querySelector('iframe')?.getAttribute('allow')).toBe(
    'fullscreen *',
  );
  expect(document.querySelector('iframe')?.getAttribute('srcdoc')).toContain(
    '&lt;script&gt;bad()&lt;/script&gt;',
  );
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
  await click('Download report');
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.stringContaining('<!doctype html>'),
      defaultFileName: 'Orders-run-1234.html',
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
  expect(document.querySelector('[role="dialog"] iframe')).toBeTruthy();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.ant-drawer-close')!.click(),
  );
  expect(document.querySelector('.ant-drawer-open')).toBeNull();
  await click('View report');
  expect(document.querySelector('[role="dialog"] iframe')).toBeTruthy();
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
  expect(document.querySelector('iframe')).toBeTruthy();
  await click('Download report');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to download report',
  );
});
it('loads a saved report from execution records without starting or regenerating a run', async () => {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    text: async () => '<!doctype html><html><body>Saved report</body></html>',
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
        value={
          {
            phase: 'ready',
            serverUrl: 'http://localhost:1234',
            controller: {
              state: { runtimeInfo: { platformId: 'web' }, formValues: {} },
            },
          } as any
        }
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
  expect(document.querySelector('iframe')).toBeTruthy();
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    'http://localhost:1234/scenario-reports',
    'http://localhost:1234/scenario-reports',
    `http://localhost:1234/scenario-reports/${run.id}`,
    `http://localhost:1234/scenario-reports/${run.id}/html`,
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

function pendingReport() {
  let resolve!: (response: Response) => void;
  return {
    response: new Promise<Response>((done) => {
      resolve = done;
    }),
    finish: (html: string) =>
      resolve({ ok: true, text: async () => html } as Response),
  };
}

function connectedReport(value = run) {
  return (
    <StudioPlaygroundContext.Provider
      value={
        {
          phase: 'ready',
          serverUrl: 'http://localhost:1234',
        } as any
      }
    >
      <StudioScenarioReport run={value} />
    </StudioPlaygroundContext.Provider>
  );
}

it('never flashes a basic or previously loaded report while opening and reopening', async () => {
  const first = pendingReport();
  const second = pendingReport();
  const fetchMock = vi
    .fn()
    .mockReturnValueOnce(first.response)
    .mockReturnValueOnce(second.response);
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => root.render(connectedReport()));
  await click('View report');
  expect(document.querySelector('iframe')).toBeNull();
  expect(
    document.querySelector('[role="dialog"] output')?.textContent,
  ).toContain('Loading report');
  expect(
    document.querySelector<HTMLButtonElement>('.studio-report-download')
      ?.disabled,
  ).toBe(true);
  await act(async () => first.finish('<html>Current full report</html>'));
  expect(document.querySelector('iframe')?.getAttribute('srcdoc')).toBe(
    '<html>Current full report</html>',
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.ant-drawer-close')!.click(),
  );
  expect(document.querySelector('iframe')).toBeNull();
  await click('View report');
  expect(document.querySelector('iframe')).toBeNull();
  await act(async () => second.finish('<html>Updated full report</html>'));
  expect(document.querySelector('iframe')?.getAttribute('srcdoc')).toBe(
    '<html>Updated full report</html>',
  );
  await click('Download report');
  expect(save).toHaveBeenLastCalledWith(
    expect.objectContaining({ content: '<html>Updated full report</html>' }),
  );
});

it('ignores late responses after switching runs or updating the same run', async () => {
  const old = pendingReport();
  const current = pendingReport();
  const updated = pendingReport();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockReturnValueOnce(old.response)
      .mockReturnValueOnce(current.response)
      .mockReturnValueOnce(updated.response),
  );
  await act(async () => root.render(connectedReport()));
  await click('View report');
  const next = { ...run, id: 'next-run' };
  await act(async () => root.render(connectedReport(next)));
  expect(document.querySelector('iframe')).toBeNull();
  await act(async () => current.finish('<html>Next run</html>'));
  await act(async () => old.finish('<html>Stale run</html>'));
  expect(document.querySelector('iframe')?.getAttribute('srcdoc')).toBe(
    '<html>Next run</html>',
  );
  await act(async () =>
    root.render(
      connectedReport({
        ...next,
        summary: { ...next.summary!, text: 'Updated summary' },
      }),
    ),
  );
  expect(document.querySelector('iframe')).toBeNull();
  await act(async () =>
    updated.finish('<html>Updated summary and evidence</html>'),
  );
  expect(document.querySelector('iframe')?.getAttribute('srcdoc')).toBe(
    '<html>Updated summary and evidence</html>',
  );
});

it('shows the basic report only after the full report request actually fails', async () => {
  const request = pendingReport();
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(request.response));
  await act(async () => root.render(connectedReport()));
  await click('View report');
  expect(document.querySelector('iframe')).toBeNull();
  await act(async () => request.finish(''));
  expect(document.querySelector('iframe')?.getAttribute('srcdoc')).toContain(
    '&lt;script&gt;bad()&lt;/script&gt;',
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Unable to load process evidence',
  );
});
