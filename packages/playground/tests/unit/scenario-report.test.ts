import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@rstest/core';
import type { ScenarioRunState } from '../../src/scenario-contract';
import { renderScenarioReport } from '../../src/scenario-report';
import {
  listScenarioReports,
  readScenarioReport,
  saveScenarioReport,
} from '../../src/scenario-report-storage';

function run(): ScenarioRunState {
  return {
    id: 'report-1',
    scenarioId: 'scene',
    scenarioName: 'Orders',
    language: 'en',
    status: 'failed',
    scriptIndex: 1,
    stepIndex: 0,
    startedAt: 1000,
    finishedAt: 3000,
    scripts: [
      {
        id: 'a',
        name: 'Order count',
        status: 'failed',
        totalSteps: 2,
        completedSteps: 0,
        steps: [
          {
            id: 'a1',
            type: 'agent-assertion',
            description: 'Count',
            instruction: 'Count is 2165',
            status: 'failed',
            error: 'Count was 2164',
          },
          {
            id: 'a2',
            type: 'agent-operation',
            description: 'Open row',
            status: 'pending',
          },
        ],
      },
      {
        id: 'b',
        name: 'Independent query',
        status: 'passed',
        totalSteps: 1,
        completedSteps: 1,
        steps: [
          {
            id: 'b1',
            type: 'playwright-operation',
            description: 'Open orders',
            status: 'passed',
            recovery: {
              status: 'recovered',
              originalError: 'Locator moved',
              reason: 'Orders visible',
              startedAt: 2000,
            },
          },
        ],
      },
    ],
  };
}
test('renders deterministic counts, failure evidence, recovery and limited coverage in four sections', () => {
  const text = renderScenarioReport(run());
  expect(text.match(/^## /gm)).toHaveLength(4);
  expect(text).toContain('Execution completed · Some failures');
  expect(text).toContain('| Steps | 3 | 1 | 1 | 0 | 1 | 0 |');
  expect(text).toContain('Count is 2165');
  expect(text).toContain('Count was 2164');
  expect(text).toContain('Passed after recovery');
  expect(text).toContain('Locator moved');
  expect(text.match(/Locator moved/g)).toHaveLength(1);
  expect(text).not.toContain('| Order count |');
  expect(text).toContain('AI analysis is unavailable');
  expect(text).toContain('2\\.0 s');
});
test('does not allow evidence or AI prose to inject report headings, HTML, images or tables', () => {
  const state = run();
  state.scenarioName =
    'Orders | ![x](https://evil)\n## Forged <script>alert(1)</script>';
  const text = renderScenarioReport(state, {
    overview: '# override\n<script>bad</script>',
    findings: [],
    limitations: [],
  });
  expect(text.match(/^## /gm)).toHaveLength(4);
  expect(text).not.toContain('<script>');
  expect(text).toContain('\\!\\[x\\]');
  expect(text).toContain('Orders \\|');
  const noChecks = run();
  noChecks.scripts = [noChecks.scripts[1]];
  noChecks.status = 'completed';
  expect(renderScenarioReport(noChecks)).toContain(
    'business correctness was not verified',
  );
});
test('stores and reloads the exact Markdown across runs without AI, rejects invalid IDs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-reports-'));
  try {
    expect(await listScenarioReports(dir)).toEqual([]);
    const first = run();
    first.summary = {
      status: 'failed',
      format: 'markdown',
      text: renderScenarioReport(first),
    };
    await saveScenarioReport(dir, first);
    const second = { ...first, id: 'report-2', finishedAt: 5000 };
    await saveScenarioReport(dir, second);
    expect((await listScenarioReports(dir)).map((x) => x.id)).toEqual([
      'report-2',
      'report-1',
    ]);
    expect((await readScenarioReport(dir, 'report-1')).summary?.text).toBe(
      first.summary.text,
    );
    first.summary = {
      ...first.summary,
      status: 'completed',
      text: '# Updated report',
    };
    await saveScenarioReport(dir, first);
    expect((await readScenarioReport(dir, 'report-1')).summary?.text).toBe(
      '# Updated report',
    );
    await expect(readScenarioReport(dir, '../report-1')).rejects.toThrow(
      'Invalid execution report ID',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
