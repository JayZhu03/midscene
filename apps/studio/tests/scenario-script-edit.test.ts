import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  agentStepInstruction,
  compileScenarioScript,
  createAgentStep,
  editScenarioScript,
  validateScenarioScript,
} from '../src/renderer/components/StudioScenarios/script-model';
import {
  getScenarioScript,
  getScenarioScriptAsset,
  renameScenarioScript,
  saveScenarioScript,
  updateScenarioScriptSteps,
} from '../src/renderer/components/StudioScenarios/script-storage';
import { buildScenarioRun } from '../src/renderer/components/StudioScenarios/sequence';
import { scenarioEvent, scenarioSession } from './fixtures/scenario-script';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());
const source = () =>
  compileScenarioScript({
    id: 'script',
    scenarioId: 'scene',
    name: 'Orders',
    session: scenarioSession({
      events: [
        scenarioEvent({ screenshotBefore: 'data:image/png;base64,AQIDBA==' }),
        scenarioEvent({ hashId: 'fallback', nativeTarget: undefined }),
        scenarioEvent({ hashId: 'last' }),
      ],
      checkpoints: [
        {
          id: 'check',
          instruction: 'Original expectation',
          afterEventHashIds: ['event-1'],
          timestamp: 2,
        },
      ],
    }),
  });
const manual = (
  type: 'agent-operation' | 'agent-assertion',
  instruction: string,
) => agentStepInstruction(createAgentStep(type), instruction);

it('persists inserted, edited and removed Agent steps without changing native code, recording, screenshots or an existing run plan', async () => {
  const saved = await saveScenarioScript(source());
  const previousRun = buildScenarioRun('scene', [saved], []);
  const snapshot = JSON.stringify(previousRun);
  const native = saved.steps.filter(
    (step) => step.type === 'playwright-operation',
  );
  const changed = await updateScenarioScriptSteps(saved, [
    manual('agent-assertion', 'Login page visible'),
    saved.steps[0],
    agentStepInstruction(saved.steps[1], 'Expected quantity is 20'),
    manual('agent-operation', 'Open the order'),
    saved.steps[3],
    manual('agent-assertion', 'Order details visible'),
  ]);
  expect(changed.recordedSteps).toEqual(saved.steps);
  expect(changed.sourceSession).toEqual(saved.sourceSession);
  expect(changed.assets).toEqual(saved.assets);
  expect(
    changed.steps.filter((step) => step.type === 'playwright-operation'),
  ).toEqual(native);
  for (const asset of saved.assets)
    expect(await getScenarioScriptAsset(asset.id)).not.toBeNull();
  const restored = (await getScenarioScript(saved.id))!;
  expect(restored).toEqual(changed);
  expect(JSON.stringify(previousRun)).toBe(snapshot);
  const nextRun = buildScenarioRun('scene', [restored], []);
  expect(nextRun.scripts[0].steps.map((step) => step.type)).toEqual([
    'agent-assertion',
    'playwright-operation',
    'agent-assertion',
    'agent-operation',
    'playwright-operation',
    'agent-assertion',
  ]);
  expect(nextRun.scripts[0].steps[2].instruction).toBe(
    'Expected quantity is 20',
  );
  expect(nextRun.scripts[0].steps[4].operationIndex).toBe(2);
  // A second edit can remove an original assertion and an inserted action.
  const twice = await updateScenarioScriptSteps(
    restored,
    restored.steps.filter((_, i) => i !== 2 && i !== 3),
  );
  expect(twice.steps).toHaveLength(4);
  expect(twice.recordedSteps).toEqual(saved.steps);
  expect(validateScenarioScript(twice)).toEqual(twice);
});

it('rejects native edits, removal, reordering, blank instructions and duplicate step IDs', () => {
  const script = source();
  const [first, assertion, operation, last] = script.steps;
  for (const steps of [
    [{ ...first, code: 'await page.close()' }, assertion, operation, last],
    [assertion, operation, last],
    [last, assertion, operation, first],
    [first, manual('agent-operation', '  '), last],
    [first, assertion, assertion, last],
  ])
    expect(() => editScenarioScript(script, steps)).toThrow();
  expect(script.steps).toHaveLength(4);
});

it('does not overwrite a renamed or deleted script and preserves the prior flow on invalid save', async () => {
  const script = await saveScenarioScript(source());
  const changed = await updateScenarioScriptSteps(script, [
    ...script.steps,
    manual('agent-operation', 'Inspect order'),
  ]);
  await expect(updateScenarioScriptSteps(script, script.steps)).rejects.toThrow(
    'changed',
  );
  const renamed = await renameScenarioScript(changed.id, 'New name');
  await expect(
    updateScenarioScriptSteps(renamed, [manual('agent-assertion', '')]),
  ).rejects.toThrow();
  expect(await getScenarioScript(script.id)).toEqual(renamed);
});
