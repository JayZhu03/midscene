import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getDebug } from '@midscene/shared/logger';
import type {
  ScenarioReportEntry,
  ScenarioRunState,
} from './scenario-contract';
import { composeScenarioHtml } from './scenario-report-html';

const reportLimit = 10;
const debug = getDebug('playground:scenario-reports', { console: true });
const directoryOperations = new Map<string, Promise<unknown>>();

// Serialize saves and pruning in the Studio process, including overlapping lists.
async function withDirectoryLock<T>(
  directory: string,
  action: () => Promise<T>,
) {
  const absolute = resolve(directory);
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const previous = directoryOperations.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  directoryOperations.set(key, current);
  try {
    return await current;
  } finally {
    if (directoryOperations.get(key) === current)
      directoryOperations.delete(key);
  }
}

function reportPath(directory: string, id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new Error('Invalid execution report ID.');
  return join(directory, `${id}.json`);
}

export async function readScenarioHtml(directory: string, id: string) {
  const path = reportPath(directory, id).replace(/\.json$/, '.html');
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Existing Markdown records remain readable, but all downloads are HTML.
    return composeScenarioHtml(await readScenarioReport(directory, id));
  }
}

export async function saveScenarioReport(
  directory: string,
  run: ScenarioRunState,
) {
  const destination = reportPath(directory, run.id);
  return withDirectoryLock(directory, async () => {
    await mkdir(directory, { recursive: true });
    const previous = await stat(destination).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (previous && !previous.isFile())
      throw new Error('Invalid report destination.');
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const htmlPath = destination.replace(/\.json$/, '.html');
    const htmlTemporary = `${htmlPath}.${randomUUID()}.tmp`;
    const evidencePath = destination.replace(/\.json$/, '.evidence.html');
    try {
      let official: string | undefined;
      try {
        official = await readFile(evidencePath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await writeFile(
        htmlTemporary,
        composeScenarioHtml(run, official),
        'utf8',
      );
      await rename(htmlTemporary, htmlPath);
      await writeFile(temporary, JSON.stringify(run), 'utf8');
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
      await rm(htmlTemporary, { force: true });
    }
    await retainedReports(directory);
  });
}

export async function readScenarioReport(
  directory: string,
  id: string,
): Promise<ScenarioRunState> {
  const data = JSON.parse(await readFile(reportPath(directory, id), 'utf8'));
  if (
    !data ||
    data.id !== id ||
    !Array.isArray(data.scripts) ||
    !data.scripts.every(
      (script: ScenarioRunState['scripts'][number]) =>
        script &&
        typeof script.status === 'string' &&
        (script.steps === undefined ||
          (Array.isArray(script.steps) &&
            script.steps.every((step) => step && typeof step === 'object'))),
    ) ||
    typeof data.summary?.text !== 'string'
  )
    throw new Error('Invalid saved execution report.');
  return data;
}

async function retainedReports(directory: string) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const reports: { run: ScenarioRunState; path: string; time: number }[] = [];
  for (const entry of entries.filter(
    (entry) =>
      entry.isFile() && /^[a-zA-Z0-9_-]{1,100}\.json$/.test(entry.name),
  )) {
    let run: ScenarioRunState;
    try {
      run = await readScenarioReport(directory, entry.name.slice(0, -5));
    } catch (error) {
      if (
        error instanceof SyntaxError ||
        (error instanceof Error &&
          error.message === 'Invalid saved execution report.')
      ) {
        debug(`Ignoring invalid saved execution report: ${entry.name}`);
        continue;
      }
      // If a file cannot be read, abort before deleting any history.
      throw error;
    }
    const path = join(directory, entry.name);
    const time =
      [run.finishedAt, run.startedAt].find(
        (value) => typeof value === 'number' && Number.isFinite(value),
      ) ?? (await stat(path)).mtimeMs;
    reports.push({ run, path, time });
  }
  reports.sort((a, b) => b.time - a.time || b.run.id.localeCompare(a.run.id));
  // Only owned, validated JSON records are removed; raw Agent reports and assets
  // are outside this directory and are never part of retention.
  for (const report of reports.slice(reportLimit)) {
    await rm(report.path);
    await rm(report.path.replace(/\.json$/, '.html'), { force: true });
    await rm(report.path.replace(/\.json$/, '.evidence.html'), { force: true });
  }
  return reports.slice(0, reportLimit).map(({ run }) => run);
}

export async function listScenarioReports(directory: string) {
  return withDirectoryLock(directory, async () => {
    const reports = await retainedReports(directory);
    return reports.map(
      (run): ScenarioReportEntry => ({
        id: run.id,
        platformId: run.platformId || 'web',
        scenarioName: run.scenarioName,
        name: run.scope === 'script' ? run.scripts[0]?.name : run.scenarioName,
        scope: run.scope,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        status: run.status,
        counts: {
          passed: run.scripts.filter((s) => s.status === 'passed').length,
          failed: run.scripts.filter((s) => s.status === 'failed').length,
          blocked: run.scripts.filter((s) => s.status === 'blocked').length,
          pending: run.scripts.filter((s) => s.status === 'pending').length,
          stopped: run.scripts.filter((s) => s.status === 'stopped').length,
          skipped: run.scripts.filter((s) => s.status === 'skipped').length,
        },
        recoveryCount: run.scripts.reduce(
          (n, s) => n + (s.steps?.filter((step) => step.recovery).length || 0),
          0,
        ),
      }),
    );
  });
}
