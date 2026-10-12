import type { ScenarioSourceSession } from '../../src/renderer/components/StudioScenarios/script-model';
import type { StudioRecordedEvent } from '../../src/renderer/recorder/types';

export const scenarioTarget = {
  platformId: 'web' as const,
  label: 'Web',
  values: { url: 'https://example.com' },
};

export function scenarioEvent(
  overrides: Partial<StudioRecordedEvent> = {},
): StudioRecordedEvent {
  return {
    hashId: 'event-1',
    type: 'click',
    actionType: 'Tap',
    platformId: 'web',
    target: scenarioTarget,
    rawPayload: {},
    timestamp: 1,
    pageInfo: { width: 1280, height: 720 },
    nativeTarget: { locator: { selector: 'button', text: 'Save' } },
    semantic: {
      source: 'heuristic',
      status: 'ready',
      actionSummary: 'Click Save',
      replayInstruction: 'Click Save',
    },
    ...overrides,
  };
}

export function scenarioSession(
  overrides: Partial<ScenarioSourceSession> = {},
): ScenarioSourceSession {
  return {
    id: 'source-session',
    name: 'Recorded source',
    status: 'completed',
    target: scenarioTarget,
    events: [scenarioEvent()],
    createdAt: 1,
    updatedAt: 3,
    startedAt: 1,
    stoppedAt: 3,
    ...overrides,
  };
}
