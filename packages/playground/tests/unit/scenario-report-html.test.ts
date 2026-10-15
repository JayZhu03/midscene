import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@rstest/core';
import type { ScenarioRunState } from '../../src/scenario-contract';
import {
  composeScenarioHtml,
  renderScenarioHtmlConclusion,
} from '../../src/scenario-report-html';
import {
  listScenarioReports,
  readScenarioHtml,
  readScenarioReport,
  saveScenarioReport,
} from '../../src/scenario-report-storage';
import { scenarioSummaryEvidence } from '../../src/scenario-summary';

function run(id = 'run'): ScenarioRunState {
  return {
    id,
    scenarioId: 's',
    scenarioName: '<script>bad()</script>',
    status: 'failed',
    scriptIndex: 0,
    stepIndex: 0,
    scripts: [
      {
        id: 's',
        name: 'Orders',
        status: 'failed',
        completedSteps: 0,
        totalSteps: 1,
        steps: [
          {
            id: 'a',
            type: 'agent-assertion',
            description: 'Count',
            instruction: 'Count is 20',
            status: 'failed',
            error: 'Actual count: 10',
          },
        ],
      },
    ],
  };
}
test('escapes model and page text, keeps failure authoritative, and isolates the official viewer', () => {
  const state = run();
  state.summary = {
    status: 'completed',
    format: 'html',
    text: renderScenarioHtmlConclusion(state, {
      overview: '<img onerror=bad()>',
      findings: [],
      limitations: [],
    }),
  };
  const html = composeScenarioHtml(
    state,
    '<html><head></head><body>official viewer</body></html>',
  );
  expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
  expect(html).toContain('&lt;img onerror=bad()&gt;');
  expect(html).toContain('Actual count: 10');
  expect(html).toContain('sandbox="allow-scripts"');
  expect(html).not.toContain('allow-same-origin');
  expect(html).toContain('执行过程');
});
test('persists self-contained evidence across report updates and prunes it with the ten-record limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scenario-html-'));
  try {
    for (let i = 1; i <= 11; i++) {
      const state = run(`run-${i}`);
      state.finishedAt = i;
      state.summary = {
        status: 'completed',
        format: 'html',
        text: renderScenarioHtmlConclusion(state),
      };
      await writeFile(
        join(dir, `${state.id}.evidence.html`),
        '<html><head></head><body>official evidence</body></html>',
      );
      await saveScenarioReport(dir, state);
      await saveScenarioReport(dir, state);
      expect(await readScenarioHtml(dir, state.id)).toContain(
        'official evidence',
      );
    }
    const files = await readdir(dir);
    expect(files.some((file) => file.startsWith('run-1.'))).toBe(false);
    expect(files.filter((file) => file.endsWith('.json'))).toHaveLength(10);
    expect(
      files.filter((file) => file.endsWith('.evidence.html')),
    ).toHaveLength(10);
    expect(files.some((file) => file.endsWith('.tmp'))).toBe(false);
    await expect(readScenarioHtml(dir, '../escape')).rejects.toThrow();
    await expect(readFile(join(dir, 'run-11.html'), 'utf8')).resolves.toContain(
      '<!doctype html>',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('preserves user-skipped coverage in saved HTML, history and AI evidence without counting it as passed', async () => {
  const state = run('skip-report');
  state.status = 'completed';
  state.scripts[0].status = 'skipped';
  state.scripts[0].steps![0].status = 'skipped';
  state.scripts[0].steps![0].error = undefined;
  const evidence = scenarioSummaryEvidence(state);
  expect(evidence.passedSteps).toBe(0);
  expect(evidence.skippedSteps).toBe(1);
  expect(evidence.checkpoints).toMatchObject({
    passed: 0,
    failed: 0,
    skipped: 1,
  });
  state.summary = {
    status: 'completed',
    format: 'html',
    text: renderScenarioHtmlConclusion(state),
  };
  const dir = await mkdtemp(join(tmpdir(), 'scenario-skip-'));
  try {
    await saveScenarioReport(dir, state);
    expect((await listScenarioReports(dir))[0].counts).toMatchObject({
      passed: 0,
      skipped: 1,
    });
    expect(
      (await readScenarioReport(dir, state.id)).scripts[0].steps![0].status,
    ).toBe('skipped');
    const html = await readScenarioHtml(dir, state.id);
    expect(html).toContain('已跳过');
    expect(html).not.toContain('全部通过');
    expect(html).not.toContain('Actual count: 10');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
