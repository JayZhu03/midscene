import type { ScenarioRunInput, ScenarioStartMode } from '@midscene/playground';
import type { ScenarioScript } from './script-model';

export interface SequenceEntry {
  id: string;
  startMode: ScenarioStartMode;
}
const key = (scenarioId: string) => `studio.scenario-sequence.v1.${scenarioId}`;

export function reconcileSequence(
  scripts: ScenarioScript[],
  saved: SequenceEntry[],
): SequenceEntry[] {
  const available = new Set(scripts.map((script) => script.id));
  const result: SequenceEntry[] = [];
  for (const item of saved) {
    if (available.delete(item.id)) result.push({ ...item });
  }
  for (const id of available) result.push({ id, startMode: 'automatic' });
  return result;
}

export function loadSequence(
  scenarioId: string,
  scripts: ScenarioScript[],
): SequenceEntry[] {
  const raw = localStorage.getItem(key(scenarioId));
  const saved: unknown = raw ? JSON.parse(raw) : [];
  if (
    !Array.isArray(saved) ||
    saved.some(
      (item) =>
        !item ||
        typeof item.id !== 'string' ||
        !['automatic', 'manual'].includes(item.startMode),
    )
  ) {
    throw new Error('Unable to load script order.');
  }
  return reconcileSequence(scripts, saved);
}

export function saveSequence(scenarioId: string, sequence: SequenceEntry[]) {
  localStorage.setItem(key(scenarioId), JSON.stringify(sequence));
}

export function moveScript(
  sequence: SequenceEntry[],
  id: string,
  targetId: string,
) {
  const from = sequence.findIndex((item) => item.id === id);
  const to = sequence.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) return sequence;
  const next = [...sequence];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export function buildScenarioRun(
  scenarioId: string,
  scripts: ScenarioScript[],
  sequence: SequenceEntry[],
): ScenarioRunInput {
  const byId = new Map(scripts.map((script) => [script.id, script]));
  return {
    scenarioId,
    scripts: reconcileSequence(scripts, sequence).map((entry, index) => {
      const script = byId.get(entry.id)!;
      return {
        id: script.id,
        name: script.name,
        startMode: index === 0 ? 'automatic' : entry.startMode,
        steps: script.steps.map((step) => {
          const base = {
            id: step.id,
            type: step.type,
            description: step.description,
          };
          if (step.type !== 'playwright-operation')
            return { ...base, instruction: step.instruction };
          // Screenshot assets and recording history remain in storage, not in the execution request.
          const source = step.sourceEvent;
          return {
            ...base,
            code: step.code,
            operationIndex: script.sourceSession.events.findIndex(
              (event) => event.hashId === source.hashId,
            ),
            event: {
              hashId: source.hashId,
              type: source.type,
              actionType: source.actionType,
              timestamp: source.timestamp,
              pageInfo: source.pageInfo,
              url: source.url,
              value: source.value,
              rawPayload: source.rawPayload,
              nativeTarget: source.nativeTarget,
            },
          };
        }),
      };
    }),
  };
}
