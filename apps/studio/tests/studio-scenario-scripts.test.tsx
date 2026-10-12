import { RecordTimeline } from '@midscene/recorder-ui';
// @vitest-environment jsdom
import { ConfigProvider } from 'antd';
import { act, createElement } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioScenarioScripts } from '../src/renderer/components/StudioScenarios/StudioScenarioScripts';
import { StudioScenarioTimeline } from '../src/renderer/components/StudioScenarios/StudioScenarioTimeline';
import { canNavigateStudio } from '../src/renderer/components/StudioScenarios/navigation';
import {
  type ScenarioScript,
  compileScenarioScript,
} from '../src/renderer/components/StudioScenarios/script-model';
import { setStudioLanguage } from '../src/renderer/i18n';
import type {
  StudioRecorderContextValue,
  StudioRecordingSession,
} from '../src/renderer/recorder/types';
import { StudioRecorderContext } from '../src/renderer/recorder/useStudioRecorder';
import { scenarioEvent, scenarioSession } from './fixtures/scenario-script';

const persistence = vi.hoisted(() => ({
  records: [] as ScenarioScript[],
  fail: false,
  save: vi.fn(),
  asset: vi.fn(async (_id: string): Promise<Blob | null> => null),
}));
vi.mock('../src/renderer/components/StudioScenarios/script-storage', () => ({
  getScenarioScriptAsset: persistence.asset,
  listScenarioScripts: vi.fn(async (id: string) =>
    persistence.records.filter((script) => script.scenarioId === id),
  ),
  saveScenarioScript: async (script: ScenarioScript) => {
    persistence.save(script);
    if (persistence.fail) throw new Error('Disk is full');
    const durable = structuredClone(script);
    persistence.records.push(durable);
    return durable;
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let recorder: StudioRecorderContextValue;
let session: StudioRecordingSession;
const scenario = {
  id: 'scenario-a',
  name: 'Login flow',
  description: '',
  createdAt: 1,
  updatedAt: 1,
};
let stopped: (() => void) | null;

async function render() {
  await act(async () =>
    root.render(
      createElement(
        ConfigProvider,
        { theme: { token: { motion: false } } },
        createElement(
          StudioRecorderContext.Provider,
          { value: { ...recorder, currentSession: session } },
          createElement(StudioScenarioScripts, {
            scenario,
            active: true,
            onBack: vi.fn(),
          }),
        ),
      ),
    ),
  );
}
function button(label: string) {
  const result = Array.from(
    document.querySelectorAll<HTMLButtonElement>('button'),
  ).find(
    (item) =>
      item.textContent === label || item.getAttribute('aria-label') === label,
  );
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function fill(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function finish() {
  await click('Stop recording');
  expect(button('Finishing recognition').disabled).toBe(true);
  expect(container.textContent).not.toContain('Save script');
  await act(async () => {
    stopped?.();
  });
}

beforeEach(() => {
  setStudioLanguage('en');
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  persistence.records = [];
  persistence.fail = false;
  persistence.save.mockClear();
  persistence.asset.mockReset().mockResolvedValue(null);
  stopped = null;
  session = scenarioSession({
    scenarioId: scenario.id,
    status: 'recording',
    events: [],
  });
  recorder = {
    state: {
      initialized: true,
      initializing: false,
      sessions: [],
      currentSessionId: null,
      isRecording: false,
      error: null,
    },
    currentSession: session,
    currentTarget: session.target,
    canStartRecording: true,
    startRecording: vi.fn(async () => session),
    stopScenarioRecording: vi.fn(
      () =>
        new Promise<StudioRecordingSession>((resolve) => {
          stopped = () => {
            session = { ...session, status: 'completed' };
            resolve(session);
          };
        }),
    ),
    addCheckpoint: vi.fn(async (_id: string, instruction: string) => {
      const checkpoint = {
        id: 'checkpoint',
        instruction,
        timestamp: 2,
        afterEventHashIds: [session.events[0].hashId],
      };
      session = { ...session, checkpoints: [checkpoint] };
      return checkpoint;
    }),
    releaseScenarioSession: vi.fn(async () => undefined),
    getRecorderScreenshotAssetUrl: vi.fn(() => null),
  } as unknown as StudioRecorderContextValue;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('scenario recording workflow', () => {
  it('records ordered mixed steps, drains before saving, and reopens saved content', async () => {
    await render();
    await click('Record new script');
    expect(recorder.startRecording).toHaveBeenCalledWith({
      scenarioId: scenario.id,
    });
    session = { ...session, events: [scenarioEvent()] };
    await render();
    await click('Insert checkpoint');
    const expectation = '  Confirmation is visible\nThe title stays exact.  ';
    await fill('Expected result', expectation);
    await click('Insert');
    await render();
    expect(recorder.addCheckpoint).toHaveBeenCalledWith(
      session.id,
      expectation,
    );
    session = {
      ...session,
      events: [
        ...session.events,
        scenarioEvent({
          hashId: 'event-2',
          nativeTarget: undefined,
          semantic: {
            source: 'heuristic',
            status: 'ready',
            actionSummary: 'Open special menu',
            replayInstruction: 'Open the special menu',
          },
        }),
      ],
    };
    await render();
    await finish();
    expect(
      container.querySelectorAll('.record-timeline-event-card'),
    ).toHaveLength(3);
    expect(container.querySelector('.record-timeline-default')).not.toBeNull();
    expect(
      container.querySelector('.record-timeline-parent-scroll'),
    ).not.toBeNull();
    expect(container.textContent).not.toMatch(/Playwright|Agent/);
    expect(container.textContent).toContain('Checkpoint');
    expect(
      container.querySelector('.studio-scenario-checkpoint-icon'),
    ).not.toBeNull();
    await click('Save script');
    await click('Save');
    expect(document.body.textContent).toContain('Please enter a script name.');
    expect(persistence.save).not.toHaveBeenCalled();
    await fill('Script name', 'Happy path');
    await click('Save');
    expect(persistence.records[0].steps.map((step) => step.type)).toEqual([
      'playwright-operation',
      'agent-assertion',
      'agent-operation',
    ]);
    expect(persistence.records[0].steps[1]).toMatchObject({
      instruction: expectation,
    });
    expect(recorder.releaseScenarioSession).toHaveBeenCalledWith(session.id);
    await click('Back to scenario');
    expect(container.textContent).toContain('Happy path');
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    await click('Happy path');
    expect(container.querySelector('h3')?.textContent).toBe('Happy path');
    expect(
      container.querySelectorAll('.record-timeline-event-card'),
    ).toHaveLength(3);
    expect(container.querySelector('pre')).toBeNull();
    await act(async () =>
      container
        .querySelectorAll<HTMLElement>('.record-timeline-event-card')[1]
        .click(),
    );
    expect(container.querySelector('pre')?.textContent).toBe(expectation);
    expect(container.querySelector('pre')?.style.maxHeight).toBe('');
    expect(container.querySelector('pre')?.style.overflow).toBe('visible');
    expect(container.textContent).not.toMatch(/Playwright|Agent/);
    expect(container.textContent).toContain(expectation);
    expect(recorder.startRecording).toHaveBeenCalledTimes(1);
  });

  it('uses original screenshot previews for saved assets without changing stored source or steps', async () => {
    const script = compileScenarioScript({
      scenarioId: scenario.id,
      name: 'Saved',
      session: scenarioSession({
        events: [
          scenarioEvent({ screenshotAfter: 'scenario-asset:image-one' }),
        ],
      }),
    });
    script.assets = [
      {
        id: 'image-one',
        eventHashId: 'event-1',
        field: 'screenshotAfter',
        mimeType: 'image/png',
        bytes: 3,
      },
    ];
    const original = structuredClone(script);
    persistence.asset.mockResolvedValue(
      new Blob(['png'], { type: 'image/png' }),
    );
    const objectUrl = vi.fn(() => 'blob:scenario-preview');
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: objectUrl,
        revokeObjectURL: revoke,
      }),
    );
    await act(async () =>
      root.render(
        createElement(StudioScenarioTimeline, { steps: script.steps, script }),
      ),
    );
    expect(persistence.asset).toHaveBeenCalledWith('image-one');
    const image = container.querySelector<HTMLImageElement>(
      '.record-timeline-screenshot-thumbnail img',
    )!;
    expect(image.getAttribute('src')).toBe('blob:scenario-preview');
    await act(async () => image.click());
    expect(document.querySelector('.ant-image-preview-wrap')).not.toBeNull();
    expect(container.querySelector('pre')).toBeNull();
    expect(script).toEqual(original);
    await act(async () => root.unmount());
    expect(revoke).toHaveBeenCalledWith('blob:scenario-preview');
    root = createRoot(container);
  });

  it('keeps the original default timeline expansion and event callback unchanged', async () => {
    const event = scenarioEvent();
    const onEventClick = vi.fn();
    await act(async () =>
      root.render(
        createElement(RecordTimeline, { events: [event], onEventClick }),
      ),
    );
    expect(container.querySelector('pre')).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLElement>('.record-timeline-event-card')!
        .click(),
    );
    expect(onEventClick).toHaveBeenCalledWith(event, 0);
    expect(container.querySelector('pre')?.textContent).toContain(
      '"hashId": "event-1"',
    );
    expect(container.querySelector('button[title="复制 JSON"]')).not.toBeNull();
    expect(container.querySelector('pre')?.style.maxHeight).toBe('250px');
    expect(container.querySelector('pre')?.style.overflow).toBe('auto');
    await act(async () =>
      container
        .querySelector<HTMLElement>('.record-timeline-event-card')!
        .click(),
    );
    expect(container.querySelector('pre')).toBeNull();
  });

  it('scrolls added steps in the scenario body rather than an inner timeline', async () => {
    await render();
    await click('Record new script');
    session = { ...session, events: [scenarioEvent()] };
    await render();
    const body = container.querySelector<HTMLElement>(
      '.studio-scenario-timeline',
    )!;
    const timeline = container.querySelector<HTMLElement>('.ant-timeline')!;
    const scrollBody = vi.fn();
    const scrollTimeline = vi.fn();
    Object.defineProperty(body, 'scrollHeight', { value: 600 });
    Object.defineProperty(body, 'scrollTo', { value: scrollBody });
    Object.defineProperty(timeline, 'scrollTo', { value: scrollTimeline });
    session = {
      ...session,
      events: [...session.events, scenarioEvent({ hashId: 'next' })],
    };
    await render();
    expect(scrollBody).toHaveBeenCalledWith({ top: 600, behavior: 'smooth' });
    expect(scrollTimeline).not.toHaveBeenCalled();
  });

  it('blocks page/mode navigation during recording and preserves failed/unsaved drafts', async () => {
    await render();
    await click('Record new script');
    let allowed = true;
    await act(async () => {
      allowed = await canNavigateStudio();
    });
    expect(allowed).toBe(false);
    expect(container.textContent).toContain('Stop recording before leaving.');
    session = { ...session, events: [scenarioEvent()] };
    await render();
    await finish();
    await click('Save script');
    await fill('Script name', 'Retry');
    persistence.fail = true;
    await click('Save');
    expect(document.body.textContent).toContain('Disk is full');
    expect(recorder.releaseScenarioSession).not.toHaveBeenCalled();
    await click('Cancel');
    let decision!: Promise<boolean>;
    await act(async () => {
      decision = canNavigateStudio();
    });
    await click('Keep editing');
    expect(await decision).toBe(false);
    expect(container.textContent).toContain('Save script');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await act(async () => {
      decision = canNavigateStudio();
    });
    await click('Discard');
    expect(await decision).toBe(true);
    expect(recorder.releaseScenarioSession).toHaveBeenCalledWith(session.id);
    expect(container.querySelector('[data-scenario-draft="true"]')).toBeNull();
  });
});
