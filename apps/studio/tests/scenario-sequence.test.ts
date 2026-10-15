// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ScenarioRunner,
  validateScenarioRun,
} from '../../../packages/playground/src/scenario-runner';
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
  it('carries visual target names into report state without changing native code or sending screenshots and model traces', () => {
    const saved = compileScenarioScript({
      scenarioId: 'scene',
      id: 'named',
      name: '查询生产订单',
      session: scenarioSession({
        events: [
          scenarioEvent({
            title: '生产订单 - KMMOM CLOUD',
            screenshotBefore: 'data:image/png;base64,recorded-image',
            semantic: {
              source: 'aiDescribe',
              status: 'ready',
              elementDescription: '生产订单筛选区域右侧的查询按钮',
              actionSummary: 'Tap 生产订单筛选区域右侧的查询按钮',
              replayInstruction:
                'Tap the 查询 button in the production order filters.',
              confidence: 'high',
              aiDescribe: {
                verifyPrompt: true,
                verifyPassed: true,
                annotatedScreenshotPath: 'recording-only.png',
              },
            },
          }),
        ],
      }),
    });
    const before = JSON.stringify(saved);
    const plan = buildScenarioRun('scene', [saved], []);
    expect(() => validateScenarioRun(plan)).not.toThrow();
    expect(plan.scripts[0].steps[0].code).toBe(saved.steps[0].code);
    expect(plan.scripts[0].steps[0].event?.semantic?.elementDescription).toBe(
      '生产订单筛选区域右侧的查询按钮',
    );
    expect(
      new ScenarioRunner(plan).state.scripts[0].steps![0].presentation,
    ).toMatchObject({
      action: 'click',
      target: '生产订单筛选区域右侧的查询按钮',
      page: '生产订单',
    });
    expect(JSON.stringify(plan)).not.toContain('recorded-image');
    expect(JSON.stringify(plan)).not.toContain('recording-only.png');
    expect(JSON.stringify(saved)).toBe(before);
  });
  it('also carries legacy element descriptions when no semantic object exists', () => {
    const saved = compileScenarioScript({
      scenarioId: 'scene',
      id: 'legacy',
      name: '查询',
      session: scenarioSession({
        events: [
          scenarioEvent({
            semantic: undefined,
            elementDescription: '查询按钮',
            title: '生产订单 - KMMOM CLOUD',
          }),
        ],
      }),
    });
    const plan = buildScenarioRun('scene', [saved], []);
    expect(() => validateScenarioRun(plan)).not.toThrow();
    expect(
      new ScenarioRunner(plan).state.scripts[0].steps![0].presentation?.target,
    ).toBe('查询按钮');
  });
});
