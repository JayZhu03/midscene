import * as reportFs from 'node:fs/promises';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, rs, test } from '@rstest/core';
import type { ScenarioRunState } from '../../src/scenario-contract';
import { renderScenarioReport } from '../../src/scenario-report';
import {
  listScenarioReports,
  readScenarioReport,
  saveScenarioReport,
} from '../../src/scenario-report-storage';

rs.mock('node:fs/promises', { spy: true });

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

function savedRun(index: number): ScenarioRunState {
  return {
    ...run(),
    id: `retained-${index}`,
    scope: index % 2 ? 'script' : 'scenario',
    finishedAt: index * 1000,
    summary: {
      status: 'completed',
      format: 'markdown',
      text: `# Report ${index}`,
    },
  };
}

test('saves only the latest ten scenario and single-script executions on disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-retention-'));
  try {
    for (let index = 1; index <= 12; index++)
      await saveScenarioReport(dir, savedRun(index));
    const records = await listScenarioReports(dir);
    expect(records.map((record) => record.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `retained-${12 - index}`),
    );
    expect(records.some((record) => record.scope === 'script')).toBe(true);
    expect(records.some((record) => record.scope === 'scenario')).toBe(true);
    expect(
      (await readdir(dir)).filter((name) => name.endsWith('.json')),
    ).toHaveLength(10);
    expect(
      (await readdir(dir)).filter((name) => name.endsWith('.html')),
    ).toHaveLength(10);
    await expect(readScenarioReport(dir, 'retained-2')).rejects.toThrow();
    expect((await readScenarioReport(dir, 'retained-12')).summary?.text).toBe(
      '# Report 12',
    );
    await saveScenarioReport(dir, {
      ...savedRun(12),
      summary: { status: 'completed', text: '# Updated' },
    });
    expect(
      (await readdir(dir)).filter((name) => name.endsWith('.json')),
    ).toHaveLength(10);
    expect(
      (await readdir(dir)).filter((name) => name.endsWith('.html')),
    ).toHaveLength(10);
    expect((await readScenarioReport(dir, 'retained-12')).summary?.text).toBe(
      '# Updated',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prunes existing history on listing and preserves unrelated or malformed files and assets', async () => {
  const base = await mkdtemp(join(tmpdir(), 'studio-retention-existing-'));
  const dir = join(base, 'scenario-reports');
  await mkdir(dir);
  try {
    for (let index = 1; index <= 12; index++) {
      const state = savedRun(index);
      // Missing completion timestamps use the execution start timestamp.
      if (index === 12) {
        state.finishedAt = undefined;
        state.startedAt = 12000;
      }
      await writeFile(join(dir, `${state.id}.json`), JSON.stringify(state));
    }
    const fallback = {
      ...savedRun(13),
      startedAt: undefined,
      finishedAt: undefined,
    };
    await writeFile(join(dir, 'retained-13.json'), JSON.stringify(fallback));
    await utimes(
      join(dir, 'retained-13.json'),
      new Date(13000),
      new Date(13000),
    );
    const preserved = {
      'bad.json': '{bad',
      'null.json': 'null',
      'script.json': JSON.stringify({
        id: 'script',
        name: 'Script definition',
        scripts: [],
      }),
      'wrong-id.json': JSON.stringify(savedRun(99)),
      'raw-agent.json': JSON.stringify({ group: 'Agent report' }),
      'draft.json.tmp': 'unfinished',
      'screenshot.png': 'image',
    };
    for (const [name, contents] of Object.entries(preserved))
      await writeFile(join(dir, name), contents);
    await mkdir(join(dir, 'folder.json'));
    await writeFile(
      join(base, 'raw-agent.json'),
      'raw report outside retention',
    );
    const records = await listScenarioReports(dir);
    expect(records.map((record) => record.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `retained-${13 - index}`),
    );
    for (const [name, contents] of Object.entries(preserved))
      expect(await readFile(join(dir, name), 'utf8')).toBe(contents);
    expect(await readFile(join(base, 'raw-agent.json'), 'utf8')).toBe(
      'raw report outside retention',
    );
    expect(
      (await readdir(dir)).filter((name) => name.startsWith('retained-')),
    ).toHaveLength(10);
    expect(await listScenarioReports(join(base, 'missing'))).toEqual([]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('does not prune history after a failed atomic save or unreadable record', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-retention-failure-'));
  try {
    for (let index = 1; index <= 11; index++)
      await writeFile(
        join(dir, `retained-${index}.json`),
        JSON.stringify(savedRun(index)),
      );
    await mkdir(join(dir, 'retained-12.json'));
    await expect(saveScenarioReport(dir, savedRun(12))).rejects.toThrow();
    expect(
      (await readdir(dir)).filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
    expect(
      (await readdir(dir)).filter((name) => name.startsWith('retained-')),
    ).toHaveLength(12);
    const unreadable = rs
      .spyOn(reportFs, 'readFile')
      .mockRejectedValueOnce(new Error('Read denied'));
    try {
      await expect(listScenarioReports(dir)).rejects.toThrow('Read denied');
    } finally {
      unreadable.mockRestore();
    }
    expect(
      (await readdir(dir)).filter((name) => name.startsWith('retained-')),
    ).toHaveLength(12);
    expect(await listScenarioReports(dir)).toHaveLength(10);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('serializes overlapping saves and lists without losing retained reports or leaving temporary files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-retention-concurrent-'));
  try {
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        index % 3 === 0
          ? listScenarioReports(dir)
          : saveScenarioReport(dir, savedRun(index + 1)),
      ),
    );
    const expected = Array.from({ length: 25 }, (_, index) => index + 1)
      .filter((index) => (index - 1) % 3 !== 0)
      .reverse()
      .slice(0, 10);
    expect((await listScenarioReports(dir)).map((record) => record.id)).toEqual(
      expected.map((index) => `retained-${index}`),
    );
    await Promise.all([
      saveScenarioReport(dir, savedRun(26)),
      saveScenarioReport(join(dir, '.'), {
        ...savedRun(26),
        summary: { status: 'completed', text: '# Final report' },
      }),
      listScenarioReports(dir),
    ]);
    expect((await readScenarioReport(dir, 'retained-26')).summary?.text).toBe(
      '# Final report',
    );
    expect(
      (await readdir(dir)).filter((name) => name.endsWith('.json')),
    ).toHaveLength(10);
    expect(
      (await readdir(dir)).filter((name) => name.endsWith('.html')),
    ).toHaveLength(10);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
    const entry = (await listScenarioReports(dir))[0];
    expect(entry.recoveryCount).toBe(1);
    expect(entry.counts.failed).toBe(
      first.scripts.filter((s) => s.status === 'failed').length,
    );
    expect(entry.counts.passed).toBe(
      first.scripts.filter((s) => s.status === 'passed').length,
    );
    expect(entry.startedAt).toBe(first.startedAt);
    expect(entry).not.toHaveProperty('summary');
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
