import {
  buildMidsceneRecorderReplayInstruction,
  getMidsceneRecorderEventDescription,
} from '@midscene/shared/recorder';
import { compileRecorderNativePlaywright } from '@midscene/shared/recorder-native';
import type {
  StudioRecordedEvent,
  StudioRecorderTarget,
  StudioRecordingSession,
} from '../../recorder/types';

export const SCENARIO_SCRIPT_NAME_MAX_LENGTH = 80;

export interface ScenarioCheckpoint {
  id: string;
  instruction: string;
  timestamp: number;
  afterEventHashIds: string[];
}

export type ScenarioSourceSession = Omit<
  StudioRecordingSession,
  'generatedCode'
> & { checkpoints?: ScenarioCheckpoint[]; scenarioId?: string };

interface ScenarioStepBase {
  id: string;
  description: string;
  code: string;
  manual?: boolean;
}

export type ScenarioScriptStep =
  | (ScenarioStepBase & {
      type: 'playwright-operation';
      sourceEvent: StudioRecordedEvent;
    })
  | (ScenarioStepBase & {
      type: 'agent-operation';
      instruction: string;
      sourceEvent?: StudioRecordedEvent;
    })
  | (ScenarioStepBase & {
      type: 'agent-assertion';
      instruction: string;
      sourceCheckpoint?: ScenarioCheckpoint;
    });

export type ScenarioScreenshotField =
  | 'screenshotAsset'
  | 'screenshotBefore'
  | 'screenshotAfter'
  | 'screenshotWithBox';

export interface ScenarioScriptAssetRef {
  id: string;
  eventHashId: string;
  field: ScenarioScreenshotField;
  mimeType: string;
  bytes: number;
}

export interface ScenarioScript {
  version: 1;
  id: string;
  scenarioId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sourceSession: ScenarioSourceSession;
  steps: ScenarioScriptStep[];
  assets: ScenarioScriptAssetRef[];
  /** Frozen recording before the first flow edit. */
  recordedSteps?: ScenarioScriptStep[];
}

function invalid(): never {
  throw new Error('Invalid scenario script data.');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

export function validateScenarioIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128)
    invalid();
  return value;
}

function timestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid();
  return value as number;
}

function text(value: unknown, maximum = 100000): string {
  if (typeof value !== 'string' || value.length > maximum) invalid();
  return value;
}

function pick(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    keys
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
}

function targetSnapshot(value: unknown): StudioRecorderTarget {
  const target = record(value);
  const values = record(target.values);
  // Runtime/model environment configuration is never part of a source snapshot.
  const selected = pick(values, [
    'url',
    'viewportWidth',
    'viewportHeight',
    'headed',
    'deviceId',
    'appPackage',
    'displayId',
    'wdaHost',
    'wdaPort',
    'wdaBaseUrl',
    'wdaMjpegUrl',
    'wdaMjpegPort',
    'sessionId',
  ]);
  if (
    Object.values(selected).some(
      (v) =>
        !['string', 'number', 'boolean'].includes(typeof v) ||
        (typeof v === 'number' && !Number.isFinite(v)),
    )
  )
    invalid();
  return {
    platformId: text(
      target.platformId,
      80,
    ) as StudioRecorderTarget['platformId'],
    label: text(target.label, 1000),
    ...(target.deviceId !== undefined
      ? { deviceId: text(target.deviceId, 4000) }
      : {}),
    values: selected as StudioRecorderTarget['values'],
  };
}

function locatorSnapshot(value: unknown, depth = 0): unknown {
  if (depth > 12) invalid();
  const locator = record(value);
  const result = pick(locator, ['selector', 'text', 'visible']);
  text(locator.selector, 10000);
  if (locator.text !== undefined) text(locator.text);
  if (locator.visible !== undefined && typeof locator.visible !== 'boolean')
    invalid();
  for (const key of ['scope', 'has']) {
    if (locator[key] !== undefined)
      result[key] = locatorSnapshot(locator[key], depth + 1);
  }
  return result;
}

function nativeSnapshot(value: unknown, depth = 0): unknown {
  if (depth > 4) invalid();
  const native = record(value);
  const result = pick(native, ['strategy', 'error', 'sensitive', 'editable']);
  for (const key of ['strategy', 'error'])
    if (native[key] !== undefined) text(native[key]);
  for (const key of ['sensitive', 'editable'])
    if (native[key] !== undefined && typeof native[key] !== 'boolean')
      invalid();
  if (native.locator !== undefined)
    result.locator = locatorSnapshot(native.locator);
  for (const key of ['position', 'selection', 'contentEditableSelection']) {
    if (native[key] !== undefined) {
      const item = record(native[key]);
      result[key] = pick(
        item,
        key === 'position' ? ['x', 'y'] : ['start', 'end', 'valueLength'],
      );
      if (
        Object.values(result[key] as object).some(
          (v) => typeof v !== 'number' || !Number.isFinite(v),
        )
      )
        invalid();
    }
  }
  if (native.guards !== undefined) {
    if (!Array.isArray(native.guards)) invalid();
    result.guards = native.guards.map((guard) => {
      const item = record(guard);
      return {
        selector: text(item.selector, 10000),
        count: timestamp(item.count),
      };
    });
  }
  if (native.dropTarget !== undefined)
    result.dropTarget = nativeSnapshot(native.dropTarget, depth + 1);
  return result;
}

function semanticSnapshot(value: unknown, depth = 0): unknown {
  if (depth > 4) invalid();
  const semantic = record(value);
  const result = pick(semantic, [
    'source',
    'status',
    'elementDescription',
    'replayInstruction',
    'actionSummary',
    'confidence',
    'error',
  ]);
  for (const item of Object.values(result)) text(item);
  if (semantic.aiDescribe !== undefined) {
    const trace = pick(record(semantic.aiDescribe), [
      'verifyPrompt',
      'verifyPassed',
      'deepLocate',
      'centerDistance',
      'expectedCenter',
      'actualCenter',
      'annotatedScreenshotPath',
    ]);
    for (const key of ['verifyPrompt', 'verifyPassed', 'deepLocate']) {
      if (trace[key] !== undefined && typeof trace[key] !== 'boolean')
        invalid();
    }
    if (
      trace.centerDistance !== undefined &&
      (typeof trace.centerDistance !== 'number' ||
        !Number.isFinite(trace.centerDistance))
    )
      invalid();
    if (trace.annotatedScreenshotPath !== undefined)
      text(trace.annotatedScreenshotPath);
    for (const key of ['expectedCenter', 'actualCenter']) {
      const point = trace[key];
      if (
        point !== undefined &&
        (!Array.isArray(point) ||
          point.length !== 2 ||
          point.some((v) => typeof v !== 'number' || !Number.isFinite(v)))
      )
        invalid();
    }
    result.aiDescribe = trace;
  }
  if (semantic.fallbackFrom !== undefined)
    result.fallbackFrom = semanticSnapshot(semantic.fallbackFrom, depth + 1);
  return result;
}

function eventSnapshot(value: unknown): StudioRecordedEvent {
  const event = record(value);
  if (
    ![
      'click',
      'drag',
      'scroll',
      'input',
      'navigation',
      'setViewport',
      'keydown',
    ].includes(String(event.type))
  )
    invalid();
  const pageInfo = record(event.pageInfo);
  if (
    [pageInfo.width, pageInfo.height].some(
      (v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0,
    )
  )
    invalid();
  const result = pick(event, [
    'type',
    'source',
    'platformId',
    'actionType',
    'url',
    'title',
    'value',
    'elementDescription',
    'descriptionLoading',
    'screenshotBefore',
    'screenshotAfter',
    'screenshotWithBox',
  ]);
  if (
    event.descriptionLoading !== undefined &&
    typeof event.descriptionLoading !== 'boolean'
  )
    invalid();
  for (const key of [
    'source',
    'platformId',
    'actionType',
    'url',
    'title',
    'value',
    'elementDescription',
    'screenshotBefore',
    'screenshotAfter',
    'screenshotWithBox',
  ]) {
    if (result[key] !== undefined)
      text(result[key], key.startsWith('screenshot') ? 100000000 : 100000);
  }
  result.hashId = validateScenarioIdentifier(event.hashId);
  result.timestamp = timestamp(event.timestamp);
  result.pageInfo = { width: pageInfo.width, height: pageInfo.height };
  result.target = targetSnapshot(event.target);
  if (event.mergedHashIds !== undefined) {
    if (!Array.isArray(event.mergedHashIds)) invalid();
    result.mergedHashIds = event.mergedHashIds.map(validateScenarioIdentifier);
  }
  if (event.rawPayload !== undefined) {
    const raw = pick(record(event.rawPayload), [
      'actionType',
      'type',
      'url',
      'title',
      'value',
      'mode',
      'duration',
      'direction',
      'distance',
      'scrollType',
      'implicitNavigationState',
      'x',
      'y',
      'endX',
      'endY',
      'keyName',
      'repeat',
      'autoDismissKeyboard',
      'triggerActionType',
      'beforeUrl',
      'afterUrl',
      'width',
      'height',
      'valueLength',
    ]);
    if (
      Object.values(raw).some(
        (v) =>
          !['string', 'number', 'boolean'].includes(typeof v) ||
          (typeof v === 'number' && !Number.isFinite(v)),
      )
    )
      invalid();
    if (
      event.rawPayload &&
      record(event.rawPayload).elementRect !== undefined
    ) {
      raw.elementRect = pick(record(record(event.rawPayload).elementRect), [
        'left',
        'top',
        'width',
        'height',
        'x',
        'y',
      ]);
      if (
        Object.values(raw.elementRect as object).some(
          (v) => typeof v !== 'number' || !Number.isFinite(v),
        )
      )
        invalid();
    }
    result.rawPayload = raw;
  }
  if (event.elementRect !== undefined) {
    result.elementRect = pick(record(event.elementRect), [
      'left',
      'top',
      'width',
      'height',
      'x',
      'y',
    ]);
    if (
      Object.values(result.elementRect as object).some(
        (v) => typeof v !== 'number' || !Number.isFinite(v),
      )
    )
      invalid();
  }
  if (event.nativeTarget !== undefined)
    result.nativeTarget = nativeSnapshot(event.nativeTarget);
  if (event.semantic !== undefined)
    result.semantic = semanticSnapshot(event.semantic);
  if (event.screenshotAsset !== undefined) {
    const asset = record(event.screenshotAsset);
    result.screenshotAsset = {
      id: validateScenarioIdentifier(asset.id),
      mimeType: text(asset.mimeType, 100),
      bytes: timestamp(asset.bytes),
    };
  }
  return result as unknown as StudioRecordedEvent;
}

export function snapshotScenarioSession(value: unknown): ScenarioSourceSession {
  const session = record(value);
  if (
    !Array.isArray(session.events) ||
    !['idle', 'recording', 'completed'].includes(String(session.status))
  )
    invalid();
  const events = session.events.map(eventSnapshot);
  const ids = events.map((event) => event.hashId);
  if (new Set(ids).size !== ids.length) invalid();
  const checkpoints = session.checkpoints ?? [];
  if (!Array.isArray(checkpoints)) invalid();
  const parsed = checkpoints.map((value) => {
    const checkpoint = record(value);
    const instruction = text(checkpoint.instruction, Number.MAX_SAFE_INTEGER);
    if (!instruction.trim() || !Array.isArray(checkpoint.afterEventHashIds))
      invalid();
    return {
      id: validateScenarioIdentifier(checkpoint.id),
      instruction,
      timestamp: timestamp(checkpoint.timestamp),
      afterEventHashIds: checkpoint.afterEventHashIds.map(
        validateScenarioIdentifier,
      ),
    };
  });
  if (new Set(parsed.map((checkpoint) => checkpoint.id)).size !== parsed.length)
    invalid();
  const createdAt = timestamp(session.createdAt);
  const updatedAt = timestamp(session.updatedAt);
  if (updatedAt < createdAt) invalid();
  const result: ScenarioSourceSession = {
    id: validateScenarioIdentifier(session.id),
    name: text(session.name, 1000),
    status: session.status as ScenarioSourceSession['status'],
    target: targetSnapshot(session.target),
    events,
    checkpoints: parsed,
    createdAt,
    updatedAt,
  };
  if (session.scenarioId !== undefined)
    result.scenarioId = validateScenarioIdentifier(session.scenarioId);
  if (session.description !== undefined)
    result.description = text(session.description);
  if (session.url !== undefined) result.url = text(session.url);
  for (const key of [
    'startedAt',
    'stoppedAt',
    'metadataGeneratedAt',
  ] as const) {
    if (session[key] !== undefined) result[key] = timestamp(session[key]);
  }
  // Clone all selected nested data; the editable recorder draft stays independent.
  return JSON.parse(JSON.stringify(result)) as ScenarioSourceSession;
}

function orderedSources(session: ScenarioSourceSession) {
  const boundaries = new Map<number, ScenarioCheckpoint[]>();
  const lineage = new Map<string, number>();
  session.events.forEach((event, index) => {
    for (const hash of [event.hashId, ...(event.mergedHashIds || [])]) {
      if (lineage.has(hash) && lineage.get(hash) !== index) invalid();
      lineage.set(hash, index);
    }
  });
  let previousBoundary = -1;
  for (const checkpoint of session.checkpoints || []) {
    let boundary = -1;
    for (const hash of checkpoint.afterEventHashIds) {
      const index = lineage.get(hash);
      if (index === undefined)
        throw new Error('Assertion boundary is missing from the recording.');
      if (boundary !== -1 && boundary !== index)
        throw new Error('Assertion boundary crosses recorded operations.');
      boundary = index;
    }
    if (boundary < previousBoundary)
      throw new Error('Assertion boundaries are out of order.');
    previousBoundary = boundary;
    const bucket = boundaries.get(boundary) || [];
    bucket.push(checkpoint);
    boundaries.set(boundary, bucket);
  }
  const sources: Array<
    { event: StudioRecordedEvent } | { checkpoint: ScenarioCheckpoint }
  > = [];
  const assertions = (index: number) => {
    for (const checkpoint of boundaries.get(index) || []) {
      sources.push({ checkpoint });
    }
  };
  assertions(-1);
  session.events.forEach((event, index) => {
    sources.push({ event });
    assertions(index);
  });
  return sources;
}

function compileSteps(session: ScenarioSourceSession): ScenarioScriptStep[] {
  const steps = orderedSources(session).map((source): ScenarioScriptStep => {
    if ('checkpoint' in source) {
      const { checkpoint } = source;
      return {
        id: `assertion:${checkpoint.id}`,
        type: 'agent-assertion',
        description: checkpoint.instruction,
        instruction: checkpoint.instruction,
        code: `await agent.aiAssert(${JSON.stringify(checkpoint.instruction)});`,
        sourceCheckpoint: checkpoint,
      };
    }
    const { event } = source;
    const description = getMidsceneRecorderEventDescription(event);
    const base = {
      id: `operation:${event.hashId}`,
      description,
      sourceEvent: event,
    };
    try {
      const code = compileRecorderNativePlaywright({
        events: [event],
        platformId: session.target.platformId,
        format: 'operation',
        sensitiveInputs: 'recorded',
        navigationMode: 'scenario',
        stepOffset: session.events.indexOf(event),
      });
      return { ...base, type: 'playwright-operation', code };
    } catch {
      const instruction =
        event.semantic?.replayInstruction ||
        buildMidsceneRecorderReplayInstruction(
          event,
          event.semantic?.elementDescription ||
            event.elementDescription ||
            description,
        );
      return {
        ...base,
        type: 'agent-operation',
        instruction,
        code: `await agent.aiAct(${JSON.stringify(instruction)});`,
      };
    }
  });
  if (!steps.length)
    throw new Error('Record an operation or add an assertion first.');
  return steps;
}

export function compileScenarioScript(input: {
  scenarioId: string;
  name: string;
  session: ScenarioSourceSession;
  id?: string;
  now?: number;
}): ScenarioScript {
  const name = text(input.name, SCENARIO_SCRIPT_NAME_MAX_LENGTH).trim();
  if (!name) invalid();
  const sourceSession = snapshotScenarioSession(input.session);
  const scenarioId = validateScenarioIdentifier(input.scenarioId);
  if (sourceSession.scenarioId && sourceSession.scenarioId !== scenarioId)
    invalid();
  const now = timestamp(input.now ?? Date.now());
  return {
    version: 1,
    id: validateScenarioIdentifier(input.id ?? crypto.randomUUID()),
    scenarioId,
    name,
    createdAt: now,
    updatedAt: now,
    sourceSession,
    steps: compileSteps(sourceSession),
    assets: [],
  };
}

export function validateScenarioScript(value: unknown): ScenarioScript {
  const script = record(value);
  if (
    script.version !== 1 ||
    !Array.isArray(script.steps) ||
    !Array.isArray(script.assets)
  )
    invalid();
  if (script.recordedSteps !== undefined) {
    if (!Array.isArray(script.recordedSteps)) invalid();
    const { recordedSteps, ...rest } = script;
    const original = validateScenarioScript({ ...rest, steps: recordedSteps });
    return {
      ...original,
      recordedSteps: original.steps,
      steps: validateEditedSteps(original.steps, script.steps),
    };
  }
  const sourceSession = snapshotScenarioSession(script.sourceSession);
  const name = text(script.name, SCENARIO_SCRIPT_NAME_MAX_LENGTH).trim();
  const createdAt = timestamp(script.createdAt);
  const updatedAt = timestamp(script.updatedAt);
  const scenarioId = validateScenarioIdentifier(script.scenarioId);
  if (
    !name ||
    updatedAt < createdAt ||
    (sourceSession.scenarioId && sourceSession.scenarioId !== scenarioId)
  )
    invalid();
  const sources = orderedSources(sourceSession);
  if (!sources.length || sources.length !== script.steps.length) invalid();
  // Preserve saved native code across compiler upgrades.
  const steps = script.steps.map((value, index): ScenarioScriptStep => {
    const step = record(value);
    if (step.manual !== undefined) invalid();
    const source = sources[index];
    const base = {
      id: text(step.id, 256),
      description: text(step.description, Number.MAX_SAFE_INTEGER),
      code: text(step.code, Number.MAX_SAFE_INTEGER),
    };
    if (!base.description.trim() || !base.code.trim()) invalid();
    if ('checkpoint' in source) {
      if (
        step.type !== 'agent-assertion' ||
        base.id !== `assertion:${source.checkpoint.id}` ||
        step.instruction !== source.checkpoint.instruction ||
        base.description !== source.checkpoint.instruction ||
        JSON.stringify(step.sourceCheckpoint) !==
          JSON.stringify(source.checkpoint)
      )
        invalid();
      return {
        ...base,
        type: 'agent-assertion',
        instruction: source.checkpoint.instruction,
        sourceCheckpoint: source.checkpoint,
      };
    }
    if (
      !['playwright-operation', 'agent-operation'].includes(
        String(step.type),
      ) ||
      base.id !== `operation:${source.event.hashId}` ||
      JSON.stringify(eventSnapshot(step.sourceEvent)) !==
        JSON.stringify(source.event)
    )
      invalid();
    if (step.type === 'agent-operation') {
      const instruction = text(step.instruction, Number.MAX_SAFE_INTEGER);
      if (!instruction.trim()) invalid();
      return {
        ...base,
        type: 'agent-operation',
        instruction,
        sourceEvent: source.event,
      };
    }
    return { ...base, type: 'playwright-operation', sourceEvent: source.event };
  });
  const rebuilt: ScenarioScript = {
    version: 1,
    id: validateScenarioIdentifier(script.id),
    scenarioId,
    name,
    createdAt,
    updatedAt,
    sourceSession,
    steps,
    assets: [],
  };
  const assetIds = new Set<string>();
  const assetFields = new Set<string>();
  rebuilt.assets = script.assets.map((value) => {
    const asset = record(value);
    const id = validateScenarioIdentifier(asset.id);
    const event = sourceSession.events.find(
      (event) => event.hashId === asset.eventHashId,
    );
    const fieldKey = `${asset.eventHashId}:${asset.field}`;
    if (
      assetIds.has(id) ||
      assetFields.has(fieldKey) ||
      !event ||
      ![
        'screenshotAsset',
        'screenshotBefore',
        'screenshotAfter',
        'screenshotWithBox',
      ].includes(String(asset.field))
    )
      invalid();
    const field = asset.field as ScenarioScreenshotField;
    const reference =
      field === 'screenshotAsset' ? event.screenshotAsset?.id : event[field];
    if (
      reference !== (field === 'screenshotAsset' ? id : `scenario-asset:${id}`)
    )
      invalid();
    const mimeType = text(asset.mimeType, 100);
    const bytes = timestamp(asset.bytes);
    if (!mimeType.startsWith('image/') || !bytes) invalid();
    assetIds.add(id);
    assetFields.add(fieldKey);
    return {
      id,
      eventHashId: validateScenarioIdentifier(asset.eventHashId),
      field,
      mimeType,
      bytes,
    };
  });
  for (const event of sourceSession.events) {
    for (const field of [
      'screenshotBefore',
      'screenshotAfter',
      'screenshotWithBox',
    ] as const) {
      if (
        event[field]?.startsWith('scenario-asset:') &&
        !assetFields.has(`${event.hashId}:${field}`)
      )
        invalid();
    }
  }
  return rebuilt;
}

export function agentStepInstruction(
  step: ScenarioScriptStep,
  instruction: string,
): ScenarioScriptStep {
  if (step.type === 'playwright-operation')
    throw new Error('Playwright steps cannot be edited.');
  return {
    ...step,
    instruction,
    description: instruction,
    code: `await agent.${step.type === 'agent-assertion' ? 'aiAssert' : 'aiAct'}(${JSON.stringify(instruction)});`,
  };
}

export function createAgentStep(
  type: 'agent-operation' | 'agent-assertion',
): ScenarioScriptStep {
  return agentStepInstruction(
    {
      id: `manual:${crypto.randomUUID()}`,
      type,
      manual: true,
      instruction: '',
      description: '',
      code: '',
    },
    '',
  );
}

function validateEditedSteps(
  original: ScenarioScriptStep[],
  values: unknown[],
): ScenarioScriptStep[] {
  if (!values.length || values.length > 10000) invalid();
  const byId = new Map(original.map((step) => [step.id, step]));
  const ids = new Set<string>();
  const result = values.map((value) => {
    const step = record(value);
    const id = text(step.id, 256);
    if (ids.has(id)) invalid();
    ids.add(id);
    const source = byId.get(id);
    if (source?.type === 'playwright-operation') {
      if (
        step.type !== source.type ||
        step.manual !== undefined ||
        step.description !== source.description ||
        step.code !== source.code ||
        JSON.stringify(eventSnapshot(step.sourceEvent)) !==
          JSON.stringify(source.sourceEvent)
      )
        throw new Error('Playwright steps cannot be edited.');
      return source;
    }
    if (!['agent-operation', 'agent-assertion'].includes(String(step.type)))
      invalid();
    if (source && source.type !== step.type) invalid();
    if (!source && (step.manual !== true || !id.startsWith('manual:')))
      invalid();
    const instruction = text(step.instruction, Number.MAX_SAFE_INTEGER);
    if (!instruction.trim())
      throw new Error('Please enter a step instruction.');
    return agentStepInstruction(
      source || {
        id,
        type: step.type as 'agent-operation' | 'agent-assertion',
        manual: true,
        description: '',
        code: '',
        instruction: '',
      },
      instruction,
    );
  });
  const nativeIds = (steps: ScenarioScriptStep[]) =>
    steps.filter((s) => s.type === 'playwright-operation').map((s) => s.id);
  if (JSON.stringify(nativeIds(original)) !== JSON.stringify(nativeIds(result)))
    throw new Error('Playwright steps cannot be edited.');
  return result;
}

export function editScenarioScript(
  script: ScenarioScript,
  steps: ScenarioScriptStep[],
): ScenarioScript {
  return validateScenarioScript({
    ...script,
    recordedSteps: script.recordedSteps || script.steps,
    steps,
    updatedAt: Math.max(Date.now(), script.updatedAt + 1),
  });
}
