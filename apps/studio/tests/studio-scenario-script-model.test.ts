import { describe, expect, it } from 'vitest';
import {
  compileScenarioScript,
  snapshotScenarioSession,
  validateScenarioScript,
} from '../src/renderer/components/StudioScenarios/script-model';
import { scenarioEvent, scenarioSession } from './fixtures/scenario-script';

describe('scenario script compiler', () => {
  it('preserves exact native, Agent fallback and user checkpoint order', () => {
    const session = scenarioSession({
      events: [
        scenarioEvent(),
        scenarioEvent({
          hashId: 'event-2',
          nativeTarget: undefined,
          semantic: {
            source: 'heuristic',
            status: 'ready',
            actionSummary: 'Open complicated menu',
            replayInstruction: 'Click the complicated menu',
          },
        }),
        scenarioEvent({
          hashId: 'event-3',
          type: 'navigation',
          actionType: 'Navigate',
          url: 'https://example.com/done',
          nativeTarget: undefined,
        }),
      ],
      checkpoints: [
        {
          id: 'initial',
          instruction: '  登录页可见\n用户名输入框为空  ',
          timestamp: 0,
          afterEventHashIds: [],
        },
        {
          id: 'save',
          instruction: 'Save notification is visible',
          timestamp: 1,
          afterEventHashIds: ['event-1'],
        },
        {
          id: 'menu',
          instruction: 'Menu opened',
          timestamp: 2,
          afterEventHashIds: ['event-2'],
        },
      ],
    });
    const script = compileScenarioScript({
      scenarioId: 'scenario',
      name: '  Happy path  ',
      session,
    });
    expect(script.name).toBe('Happy path');
    expect(script.steps.map((step) => step.type)).toEqual([
      'agent-assertion',
      'playwright-operation',
      'agent-assertion',
      'agent-operation',
      'agent-assertion',
      'playwright-operation',
    ]);
    expect(script.steps[0]).toMatchObject({
      instruction: session.checkpoints![0].instruction,
      description: session.checkpoints![0].instruction,
      code: `await agent.aiAssert(${JSON.stringify(session.checkpoints![0].instruction)});`,
    });
    expect(script.steps[1]).toMatchObject({
      description: 'Click Save',
      sourceEvent: { hashId: 'event-1' },
    });
    expect(script.steps[1].code).toContain('await target1.click();');
    expect(script.steps[3].code).toBe(
      'await agent.aiAct("Click the complicated menu");',
    );
    expect(script.steps[5].code).toContain('await page.goto(');
    expect(script.steps.map((step) => step.code).join('\n')).not.toMatch(
      /test\(|newPage|test.use|import /,
    );
    session.events[0].semantic!.actionSummary = 'changed';
    expect(script.sourceSession.events[0].semantic!.actionSummary).toBe(
      'Click Save',
    );
    expect(validateScenarioScript(script)).toEqual(script);
  });

  it('uses merged hash lineage instead of unreliable timestamps', () => {
    const script = compileScenarioScript({
      scenarioId: 'scenario',
      name: 'Lineage',
      session: scenarioSession({
        events: [
          scenarioEvent({
            hashId: 'combined',
            timestamp: 900,
            mergedHashIds: ['part-1', 'part-2'],
          }),
          scenarioEvent({ hashId: 'later', timestamp: 1 }),
        ],
        checkpoints: [
          {
            id: 'check',
            instruction: 'Expected result',
            timestamp: 0,
            afterEventHashIds: ['part-1', 'combined', 'part-2'],
          },
        ],
      }),
    });
    expect(script.steps.map((step) => step.id)).toEqual([
      'operation:combined',
      'assertion:check',
      'operation:later',
    ]);
  });

  it('rejects lost or contradictory checkpoint boundaries without dropping assertions', () => {
    for (const anchors of [['missing'], ['event-1', 'event-2']]) {
      expect(() =>
        compileScenarioScript({
          scenarioId: 'scenario',
          name: 'Bad',
          session: scenarioSession({
            events: [scenarioEvent(), scenarioEvent({ hashId: 'event-2' })],
            checkpoints: [
              {
                id: 'checkpoint',
                instruction: 'Check',
                timestamp: 2,
                afterEventHashIds: anchors,
              },
            ],
          }),
        }),
      ).toThrow(/boundary/);
    }
  });

  it('keeps unsupported and non-Web operations as Agent steps', () => {
    for (const session of [
      scenarioSession({
        events: [scenarioEvent({ type: 'click', actionType: 'UnknownAction' })],
      }),
      scenarioSession({
        target: {
          platformId: 'android',
          label: 'Android',
          values: { deviceId: 'device' },
        },
      }),
    ]) {
      const script = compileScenarioScript({
        scenarioId: 'scenario',
        name: 'Fallback',
        session,
      });
      expect(script.steps[0].type).toBe('agent-operation');
      expect(script.steps[0].code).toBe('await agent.aiAct("Click Save");');
    }
  });

  it('retains full long assertion text without generating DOM expectations', () => {
    const instruction = `  多行断言\n${'业务结果正确\n'.repeat(2000)}  `;
    const script = compileScenarioScript({
      scenarioId: 'scenario',
      name: 'Assertion only',
      session: scenarioSession({
        events: [],
        checkpoints: [
          {
            id: 'checkpoint',
            instruction,
            timestamp: 2,
            afterEventHashIds: [],
          },
        ],
      }),
    });
    expect(script.steps[0]).toMatchObject({
      type: 'agent-assertion',
      instruction,
      description: instruction,
    });
    expect(script.steps[0].code).not.toContain('expect(');
  });

  it('whitelists source target/raw fields and excludes model environment secrets', () => {
    const session = scenarioSession();
    session.target = {
      ...session.target,
      values: {
        ...session.target.values,
        MIDSCENE_MODEL_API_KEY: 'secret-config',
        baseUrl: 'secret-endpoint',
        modelName: 'secret-model',
      },
    };
    session.events[0].target = session.target;
    session.events[0].rawPayload = {
      mode: 'replace',
      modelConfig: { apiKey: 'secret-raw' },
      MIDSCENE_MODEL_API_KEY: 'secret-env',
    };
    const snapshot = snapshotScenarioSession({
      ...session,
      generatedCode: { playwright: 'secret-generated' },
    });
    expect(snapshot.target.values).toEqual({ url: 'https://example.com' });
    expect(snapshot.events[0].rawPayload).toEqual({ mode: 'replace' });
    expect(JSON.stringify(snapshot)).not.toContain('secret-');
  });

  it('validates name, identity, shape and description/execution pairing', () => {
    const script = compileScenarioScript({
      scenarioId: 'scenario',
      name: 'Valid',
      session: scenarioSession(),
    });
    for (const invalid of [
      { ...script, id: '' },
      { ...script, scenarioId: 'x'.repeat(129) },
      { ...script, name: 'x'.repeat(81) },
      { ...script, updatedAt: -1 },
      { ...script, steps: [{ ...script.steps[0], code: '' }] },
      {
        ...script,
        steps: [
          {
            ...script.steps[0],
            sourceEvent: scenarioEvent({ hashId: 'wrong-source' }),
          },
        ],
      },
      { ...script, sourceSession: { ...script.sourceSession, events: {} } },
    ])
      expect(() => validateScenarioScript(invalid)).toThrow();
    expect(() =>
      compileScenarioScript({
        scenarioId: 'scenario',
        name: '  ',
        session: scenarioSession(),
      }),
    ).toThrow();
    expect(() =>
      compileScenarioScript({
        scenarioId: 'scenario',
        name: 'Valid',
        session: scenarioSession({ events: [] }),
      }),
    ).toThrow(/operation or add an assertion/);
  });

  it('validates saved execution structurally without rerunning the current compiler', () => {
    const script = compileScenarioScript({
      scenarioId: 'scenario',
      name: 'Frozen',
      session: scenarioSession(),
    });
    script.steps[0].code =
      '{\n  const savedTarget = page.locator("button");\n  await savedTarget.click();\n}';
    expect(validateScenarioScript(script).steps[0].code).toBe(
      script.steps[0].code,
    );
  });

  it('retains test passwords directly in scenario operations', () => {
    const input = scenarioEvent({
      type: 'input',
      actionType: 'Input',
      value: 'private',
      nativeTarget: {
        locator: { selector: 'input' },
        editable: true,
        sensitive: true,
      },
    });
    const script = compileScenarioScript({
      scenarioId: 'scenario',
      name: 'Secrets',
      session: scenarioSession({
        events: [input, { ...input, hashId: 'event-2' }],
      }),
    });
    expect(script.steps[0].code).toContain('fill("private")');
    expect(script.steps[1].code).toContain('fill("private")');
    expect(script.steps.map((step) => step.code).join('\n')).not.toContain(
      'MIDSCENE_INPUT_',
    );
  });
});
