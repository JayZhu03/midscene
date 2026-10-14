// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { compileScenarioScript } from '../src/renderer/components/StudioScenarios/script-model';
import {
  buildScenarioRun,
  loadSequence,
  moveScript,
  reconcileSequence,
  saveSequence,
} from '../src/renderer/components/StudioScenarios/sequence';
import { scenarioEvent, scenarioSession } from './fixtures/scenario-script';

const script = (id: string) =>
  compileScenarioScript({
    scenarioId: 'scene',
    id,
    name: id,
    session: scenarioSession({
      events: [scenarioEvent({ actionType: 'Click' })],
    }),
  });
beforeEach(() => localStorage.clear());
describe('scenario sequence', () => {
  it('carries the Android app to the runner and rejects mixing web and Android', () => {
    const android = script('android');
    android.sourceSession.target = {
      platformId: 'android',
      label: 'Phone',
      values: { appPackage: 'com.example.mom' },
    };
    const plan = buildScenarioRun('scene', [android], []);
    expect(plan.platformId).toBe('android');
    expect(plan.appPackage).toBe('com.example.mom');
    expect(() =>
      buildScenarioRun('scene', [android, script('web')], []),
    ).toThrow('one platform');
  });
  it('loads old scripts in stable order, saves reordering and preserves start modes', () => {
    const scripts = [script('a'), script('b'), script('c')];
    const initial = loadSequence('scene', scripts);
    initial[1].startMode = 'manual';
    const reordered = moveScript(initial, 'b', 'a');
    saveSequence('scene', reordered);
    expect(loadSequence('scene', scripts)).toEqual(reordered);
    expect(reordered.map((item) => item.id)).toEqual(['b', 'a', 'c']);
    expect(
      reconcileSequence([scripts[0], scripts[2], script('d')], reordered).map(
        (item) => item.id,
      ),
    ).toEqual(['a', 'c', 'd']);
    expect(
      buildScenarioRun('scene', scripts, reordered).scripts[0].startMode,
    ).toBe('automatic');
    expect(reordered[0].startMode).toBe('manual');
  });
  it('builds an immutable native execution plan without screenshot data', () => {
    const scripts = [script('a')];
    const plan = buildScenarioRun(
      'scene',
      scripts,
      loadSequence('scene', scripts),
    );
    expect(plan.scripts[0].steps[0].type).toBe('playwright-operation');
    expect(plan.scripts[0].steps[0].operationIndex).toBe(0);
    expect(plan.scripts[0].steps[0].code).toBe(scripts[0].steps[0].code);
    expect(plan.scripts[0].steps[0].event).not.toHaveProperty(
      'screenshotBefore',
    );
  });
  it('rejects corrupt preferences instead of silently executing a different order', () => {
    localStorage.setItem('studio.scenario-sequence.v1.scene', '{}');
    expect(() => loadSequence('scene', [script('a')])).toThrow();
  });
});
