import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScenarioRunState } from './scenario-contract';

function reportPath(directory: string, id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new Error('Invalid execution report ID.');
  return join(directory, `${id}.json`);
}

export async function saveScenarioReport(
  directory: string,
  run: ScenarioRunState,
) {
  const destination = reportPath(directory, run.id);
  await mkdir(directory, { recursive: true });
  await writeFile(`${destination}.tmp`, JSON.stringify(run), 'utf8');
  await rename(`${destination}.tmp`, destination);
}

export async function readScenarioReport(
  directory: string,
  id: string,
): Promise<ScenarioRunState> {
  const data = JSON.parse(await readFile(reportPath(directory, id), 'utf8'));
  if (
    data.id !== id ||
    !Array.isArray(data.scripts) ||
    typeof data.summary?.text !== 'string'
  )
    throw new Error('Invalid saved execution report.');
  return data;
}

export async function listScenarioReports(directory: string) {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const results = [];
  for (const name of names.filter((name) =>
    /^[a-zA-Z0-9_-]{1,100}\.json$/.test(name),
  )) {
    const run = await readScenarioReport(directory, name.slice(0, -5));
    results.push({
      id: run.id,
      scenarioName: run.scenarioName,
      name: run.scope === 'script' ? run.scripts[0]?.name : run.scenarioName,
      finishedAt: run.finishedAt,
      status: run.status,
    });
  }
  return results.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
}
