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
  const analysis = {
    overview: '<img onerror=bad()>',
    findings: [],
    limitations: [],
  };
  state.summary = {
    status: 'completed',
    format: 'html',
    analysis,
    text: renderScenarioHtmlConclusion(state, analysis),
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
        '<html><head></head><body><script type="midscene_web_dump">{"source":"official evidence"}</script></body></html>',
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

test('unified viewer copies real evidence attachments and treats model text only as data', () => {
  const state = run();
  state.scripts[0].steps![0].instruction = '</script><script>bad()</script>';
  const template =
    '<!doctype html><html><head><title>Report</title></head><body><div id="root"></div><script>loadCurrentViewer()</script></body></html>';
  const evidence =
    '<html><body><script>oldViewer()</script><script type="midscene_web_dump">{"executions":[]}</script><script type="midscene-image" data-id="real">data:image/png;base64,real</script><script type="midscene-animated-webp-manifest">{"version":1}</script></body></html>';
  const html = composeScenarioHtml(state, evidence, template);
  expect(html).toContain('loadCurrentViewer()');
  expect(html).not.toContain('oldViewer()');
  expect(html).not.toContain('<iframe');
  expect(html).not.toContain('</script><script>bad()');
  expect(html).toContain('data:image/png;base64,real');
  expect(html).toContain('type="midscene-animated-webp-manifest"');
  const payload = html.match(
    /<script type="midscene_scenario_dump">([\s\S]*?)<\/script>/,
  )![1];
  expect(JSON.parse(payload)).toEqual(state);
  expect(html).not.toContain('allow-same-origin');
  expect(html).toContain('__report_storage_probe__');
});

test('history is rendered using current viewer and real evidence without changing saved records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scenario-current-viewer-'));
  const state = run('old-record');
  state.summary = {
    status: 'completed',
    text: 'Saved old analysis',
    format: 'markdown',
  };
  const saved = JSON.stringify(state);
  try {
    await writeFile(join(dir, `${state.id}.json`), saved);
    await writeFile(join(dir, `${state.id}.html`), 'obsolete view');
    await writeFile(
      join(dir, `${state.id}.evidence.html`),
      '<script type="midscene-image" data-id="real">data:image/png;base64,history</script>',
    );
    const html = await readScenarioHtml(dir, state.id);
    expect(html).not.toBe('obsolete view');
    expect(html).toContain('midscene_scenario_dump');
    expect(html).toContain('data:image/png;base64,history');
    expect(html).toContain('Saved old analysis');
    expect(await readFile(join(dir, `${state.id}.json`), 'utf8')).toBe(saved);
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
