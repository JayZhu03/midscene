import { compileRecorderNativePlaywright } from '@midscene/shared/recorder-native';
import { describe, expect, rs, test } from '@rstest/core';
import type { ScenarioRunInput } from '../../src/scenario-contract';
import {
  connectScenarioPage,
  executeScenarioNative,
  waitForScenarioNavigation,
} from '../../src/scenario-native';
import { SCENARIO_PAGE_NOT_READY } from '../../src/scenario-readiness';
import { saveScenarioReport } from '../../src/scenario-report-storage';
import { generateScenarioSummary } from '../../src/scenario-summary';
import { PlaygroundServer } from '../../src/server';

rs.mock('../../src/scenario-native', () => ({
  connectScenarioPage: rs.fn(async () => ({
    page: {},
    waitForAssertionReady: async () => {},
    close: async () => {},
  })),
  executeScenarioNative: rs.fn(async () => {}),
  waitForScenarioNavigation: rs.fn(async () => {}),
}));
rs.mock('../../src/scenario-summary', () => ({
  generateScenarioSummary: rs.fn(async () => ({
    status: 'completed',
    format: 'markdown',
    text: 'Execution reviewed.',
  })),
  basicScenarioSummary: rs.fn(() => ({
    status: 'failed',
    format: 'markdown',
    text: 'Basic execution report.',
  })),
}));
rs.mock('../../src/scenario-report-storage', () => ({
  saveScenarioReport: rs.fn(async () => {}),
  listScenarioReports: rs.fn(async () => []),
  readScenarioReport: rs.fn(async () => ({})),
}));
const response = () => ({
  statusCode: 200,
  body: undefined as any,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(body: unknown) {
    this.body = body;
    return this;
  },
});
function handler(
  server: PlaygroundServer,
  method: 'get' | 'post',
  path: string,
) {
  return (server.app[method] as any).mock.calls.find(
    (call: any[]) => call[0] === path,
  )[1];
}
function plan(): ScenarioRunInput {
  return {
    scenarioId: 'scene',
    scripts: ['a', 'b'].map((id, index) => ({
      id,
      name: id,
      startMode: index === 0 ? 'automatic' : 'manual',
      steps: [
        { id, type: 'agent-assertion', instruction: id, description: id },
      ],
    })),
  };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Scenario did not settle');
}
async function setup() {
  const agent = {
    interface: {
      actionSpace: () => [],
      interfaceType: 'puppeteer',
      screenshotBase64: rs.fn(async () => 'data:image/png;base64,current'),
    },
    aiAssert: rs.fn(async () => ({ pass: true, thought: '' })),
    aiQuery: rs.fn(async () => ({
      allowed: false,
      reason: 'Required order is missing',
    })),
    aiAct: rs.fn(async () => {}),
    destroy: rs.fn(async () => {}),
    resetDump: rs.fn(),
  };
  Object.assign(agent, {
    startObserving: rs.fn(async () => ({
      stop: async () => ({
        aiAssert: (...args: any[]) => (agent.aiAssert as any)(...args),
        startedAt: Date.now(),
        endedAt: Date.now(),
      }),
      dispose: async () => {},
    })),
  });
  const server = new PlaygroundServer(agent as any);
  await server.launch(6198);
  const status = () => {
    const res = response();
    handler(server, 'get', '/scenario-runs')({}, res);
    return res.body;
  };
  return { server, agent, status };
}
describe('scenario routes', () => {
  test('skip rejects stale requests, never runs the skipped assertion and saves its result', async () => {
    const { server, agent, status } = await setup();
    try {
      const start = response();
      handler(server, 'post', '/scenario-runs')({ body: plan() }, start);
      await until(() => status().run.status === 'waiting');
      const command = handler(server, 'post', '/scenario-runs/:id/:action');
      const stale = response();
      command(
        {
          params: { id: status().run.id, action: 'skip' },
          body: { scriptIndex: 0 },
        },
        stale,
      );
      expect(stale.statusCode).toBe(409);
      const skipped = response();
      command(
        {
          params: { id: status().run.id, action: 'skip' },
          body: { scriptIndex: 1 },
        },
        skipped,
      );
      expect(skipped.statusCode).toBe(200);
      await until(() => !status().busy);
      expect(agent.aiAssert).toHaveBeenCalledTimes(1);
      expect(status().run.status).toBe('completed');
      expect(status().run.scripts[1].status).toBe('skipped');
      expect(status().run.scripts[1].steps[0].status).toBe('skipped');
      await until(() => status().run.summary?.status === 'completed');
      expect(saveScenarioReport).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          scripts: expect.arrayContaining([
            expect.objectContaining({ status: 'skipped' }),
          ]),
        }),
      );
    } finally {
      await server.close();
    }
  });

  test('captures logout before its click and keeps the same observation across recorded redirects', async () => {
    const { server, agent, status } = await setup();
    const order: string[] = [];
    const observedAssert = rs.fn(async () => {
      order.push('assert');
      return { pass: true, thought: '退出登录成功' };
    });
    const dispose = rs.fn(async () => {
      order.push('dispose');
    });
    const start = rs.fn(async () => {
      order.push('baseline');
      const startedAt = Date.now();
      return {
        stop: async () => {
          order.push('stop');
          return { startedAt, endedAt: Date.now(), aiAssert: observedAssert };
        },
        dispose,
      };
    });
    Object.assign(agent, { startObserving: start });
    const events = [
      {
        hashId: 'logout',
        type: 'click' as const,
        actionType: 'Tap',
        url: 'https://example.test/home',
        nativeTarget: { locator: { selector: '#logout' } },
      },
      {
        hashId: 'redirect',
        type: 'navigation' as const,
        actionType: 'Navigate',
        url: 'https://example.test/login',
        rawPayload: { implicitNavigationState: true },
      },
      {
        hashId: 'route',
        type: 'navigation' as const,
        actionType: 'NavigationChanged',
        url: 'https://example.test/login',
      },
    ].map((event) => ({
      ...event,
      timestamp: 1,
      pageInfo: { width: 900, height: 600 },
    }));
    const input = plan();
    input.scripts = [input.scripts[0]];
    input.scripts[0].steps = [
      ...events.map((event, operationIndex) => ({
        id: event.hashId,
        type: 'playwright-operation' as const,
        description: event.hashId,
        event,
        operationIndex,
        code: compileRecorderNativePlaywright({
          events: [event],
          platformId: 'web',
          format: 'operation',
          stepOffset: operationIndex,
          sensitiveInputs: 'recorded',
          navigationMode: 'scenario',
        }),
      })),
      {
        id: 'toast',
        type: 'agent-assertion',
        description: '退出登录成功',
        instruction: '右上角弹出退出登录成功',
      },
      {
        id: 'toast-again',
        type: 'agent-assertion',
        description: '登录页',
        instruction: '当前显示登录页',
      },
    ];
    for (const event of events)
      rs.mocked(executeScenarioNative).mockImplementationOnce(async () => {
        order.push(event.hashId);
        return undefined;
      });
    try {
      handler(server, 'post', '/scenario-runs')({ body: input }, response());
      await until(() => !status().busy);
      expect(status().run.status).toBe('completed');
      expect(start).toHaveBeenCalledTimes(1);
      expect(order).toEqual([
        'baseline',
        'logout',
        'redirect',
        'route',
        'stop',
        'assert',
        'assert',
        'dispose',
      ]);
      expect(observedAssert).toHaveBeenCalledTimes(2);
      expect((observedAssert.mock.calls[0] as any)[2].context).toContain(
        'operation "logout"',
      );
      expect(agent.aiAssert).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
  test('runs Android operations and visual assertions without attaching Playwright or resetting app data', async () => {
    const { server, agent, status } = await setup();
    const screenshots = rs.fn(async () => 'data:image/png;base64,live');
    const terminate = rs.fn(async () => {});
    const launch = rs.fn(async () => {});
    Object.assign(agent.interface, {
      interfaceType: 'android',
      screenshotBase64: screenshots,
      terminate,
      launch,
    });
    const input = plan();
    input.platformId = 'android';
    input.appPackage = 'com.example.mom';
    input.sessionMode = 'fresh';
    input.scripts = [input.scripts[0]];
    input.scripts[0].steps.unshift({
      id: 'tap',
      type: 'agent-operation',
      description: 'Open orders',
      instruction: 'Open orders',
    });
    const before = rs.mocked(connectScenarioPage).mock.calls.length;
    try {
      const res = response();
      handler(server, 'post', '/scenario-runs')({ body: input }, res);
      expect(res.statusCode).toBe(202);
      await until(() => !status().busy);
      expect(status().run.status).toBe('completed');
      expect(status().run.platformId).toBe('android');
      expect(terminate).toHaveBeenCalledWith('com.example.mom');
      expect(launch).toHaveBeenCalledWith('com.example.mom');
      expect(screenshots).toHaveBeenCalledTimes(2);
      expect(agent.aiAct).toHaveBeenCalledTimes(1);
      expect(agent.aiAssert).toHaveBeenCalledTimes(1);
      expect(rs.mocked(connectScenarioPage).mock.calls.length).toBe(before);
    } finally {
      await server.close();
    }
  });

  test('rejects a web scenario on Android before executing any steps', async () => {
    const { server, agent } = await setup();
    agent.interface.interfaceType = 'android';
    try {
      const res = response();
      handler(server, 'post', '/scenario-runs')({ body: plan() }, res);
      expect(res.statusCode).toBe(400);
      expect(agent.aiAssert).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  test('does not restart Android without an explicit target app', async () => {
    const { server, agent, status } = await setup();
    const terminate = rs.fn();
    Object.assign(agent.interface, { interfaceType: 'android', terminate });
    const input = {
      ...plan(),
      platformId: 'android' as const,
      sessionMode: 'fresh' as const,
    };
    try {
      handler(server, 'post', '/scenario-runs')({ body: input }, response());
      await until(() => !status().busy);
      expect(status().run.error).toContain('target application');
      expect(terminate).not.toHaveBeenCalled();
      expect(agent.aiAssert).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
  test('rechecks an associated route after an Agent claims the failed menu operation completed', async () => {
    const { server, agent, status } = await setup();
    const beforeUrl = 'https://example.test/app/#/workbench';
    const afterUrl = 'https://example.test/app/#/orders';
    const events = [
      {
        hashId: 'observed',
        type: 'navigation' as const,
        actionType: 'Navigate',
        url: afterUrl,
        timestamp: 1,
        pageInfo: { width: 900, height: 600 },
        rawPayload: {
          implicitNavigationState: true,
          triggerActionType: 'SessionNavigation',
          beforeUrl,
          afterUrl,
        },
      },
      {
        hashId: 'menu',
        type: 'click' as const,
        actionType: 'Tap',
        url: beforeUrl,
        timestamp: 2,
        pageInfo: { width: 900, height: 600 },
        nativeTarget: { locator: { selector: '#orders' } },
      },
    ];
    const input = plan();
    input.scripts = [input.scripts[0]];
    input.scripts[0].steps.unshift(
      ...events.map((event, operationIndex) => ({
        id: event.hashId,
        type: 'playwright-operation' as const,
        description: event.hashId,
        event,
        operationIndex,
        code: compileRecorderNativePlaywright({
          events: [event],
          platformId: 'web',
          format: 'operation',
          stepOffset: operationIndex,
          sensitiveInputs: 'recorded',
          navigationMode: 'scenario',
        }),
      })),
    );
    rs.mocked(executeScenarioNative)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('菜单点击后未切换到录制页面。'));
    agent.aiQuery.mockResolvedValueOnce({
      decision: 'completed',
      reason: 'Menu appears selected',
    } as any);
    rs.mocked(waitForScenarioNavigation).mockRejectedValueOnce(
      new Error('菜单点击后未切换到录制页面。'),
    );
    try {
      handler(server, 'post', '/scenario-runs')({ body: input }, response());
      await until(() => !status().busy);
      expect(rs.mocked(executeScenarioNative).mock.calls[1][4]).toMatchObject({
        navigationEffect: {
          beforeUrl,
          afterUrl,
          observationStepId: 'observed',
        },
      });
      expect(waitForScenarioNavigation).toHaveBeenCalledTimes(1);
      expect(agent.aiAct).not.toHaveBeenCalled();
      expect(agent.aiAssert).not.toHaveBeenCalled();
      expect(status().run.status).toBe('failed');
      expect(status().run.scripts[0].steps[1].recovery.status).toBe('failed');
      expect(status().run.scripts[0].steps[2].status).toBe('pending');
    } finally {
      await server.close();
    }
  });

  test('hands a failed native operation to the same Agent and resumes after visual verification', async () => {
    const { server, agent, status } = await setup();
    const event = {
      hashId: 'click',
      type: 'click' as const,
      actionType: 'Tap',
      timestamp: 1,
      pageInfo: { width: 1920, height: 1080 },
      nativeTarget: { locator: { selector: '#save' } },
    };
    const input = plan();
    input.scripts = [input.scripts[0]];
    input.scripts[0].steps.unshift({
      id: 'native',
      type: 'playwright-operation',
      description: 'Click Save',
      event,
      operationIndex: 0,
      code: compileRecorderNativePlaywright({
        events: [event],
        platformId: 'web',
        format: 'operation',
        stepOffset: 0,
        sensitiveInputs: 'recorded',
        navigationMode: 'scenario',
      }),
    });
    rs.mocked(executeScenarioNative).mockRejectedValueOnce(
      new Error('Target moved'),
    );
    agent.aiQuery
      .mockResolvedValueOnce({
        decision: 'act',
        reason: 'Save moved; form not submitted',
        instruction: 'Click Save',
      } as any)
      .mockResolvedValueOnce({ completed: true, reason: 'Saved' } as any);
    try {
      handler(server, 'post', '/scenario-runs')({ body: input }, response());
      await until(() => !status().busy);
      expect(agent.aiAct).toHaveBeenCalledTimes(1);
      expect(agent.aiQuery).toHaveBeenCalledTimes(2);
      expect(agent.aiAssert).toHaveBeenCalledTimes(1);
      expect(status().run.status).toBe('completed');
      expect(status().run.scripts[0].steps[0].recovery).toMatchObject({
        status: 'recovered',
        originalError: 'Target moved',
        reason: 'Saved',
      });
    } finally {
      await server.close();
    }
  });
  test('continues a later independent script after a failed count assertion', async () => {
    const { server, agent, status } = await setup();
    const input = plan();
    input.scripts[1].startMode = 'automatic';
    agent.aiAssert.mockResolvedValueOnce({
      pass: false,
      thought: 'Expected 2165; found 2164',
    });
    agent.aiQuery.mockResolvedValueOnce({
      allowed: true,
      reason: 'The next query is independent',
    });
    try {
      handler(server, 'post', '/scenario-runs')({ body: input }, response());
      await until(() => !status().busy);
      expect(
        status().run.scripts.map((s: { status: string }) => s.status),
      ).toEqual(['failed', 'passed']);
      expect(status().run.status).toBe('failed');
      expect(agent.aiAct).not.toHaveBeenCalled();
      expect(agent.aiAssert).toHaveBeenCalledTimes(2);
    } finally {
      await server.close();
    }
  });
  test('does not ask the model for a verdict until the page is ready', async () => {
    const { server, agent, status } = await setup();
    let ready!: () => void;
    const waiting = new Promise<void>((resolve) => {
      ready = resolve;
    });
    rs.mocked(connectScenarioPage).mockResolvedValueOnce({
      page: {} as any,
      waitForAssertionReady: () => waiting,
      close: async () => {},
    });
    try {
      handler(server, 'post', '/scenario-runs')({ body: plan() }, response());
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(agent.aiAssert).not.toHaveBeenCalled();
      ready();
      await until(() => status().run.status === 'waiting');
      expect(agent.aiAssert).toHaveBeenCalledTimes(1);
    } finally {
      ready();
      await server.close();
    }
  });
  test('reports a readiness blocker without invoking the assertion model', async () => {
    const { server, agent, status } = await setup();
    rs.mocked(connectScenarioPage).mockResolvedValueOnce({
      page: {} as any,
      waitForAssertionReady: async () => {
        throw new Error(SCENARIO_PAGE_NOT_READY);
      },
      close: async () => {},
    });
    try {
      const input = plan();
      input.scripts = input.scripts.slice(0, 1);
      handler(server, 'post', '/scenario-runs')({ body: input }, response());
      await until(() => !status().busy);
      expect(status().run.status).toBe('blocked');
      expect(status().run.error).toBe(SCENARIO_PAGE_NOT_READY);
      expect(agent.aiAssert).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
  test('switches once for a whole scenario, rebinds preview and restores only after execution', async () => {
    const { server, agent, status } = await setup();
    const freshAgent = { ...agent, destroy: rs.fn(async () => {}) };
    const preview = { kind: 'mjpeg', mjpegPath: '/mjpeg?fps=15' };
    (server as any)._activeConnection.runtime = { preview };
    const originalStream = server.getRuntimeInfo().preview?.mjpegPath;
    const switchSession = rs.fn(async (mode: string) => ({
      agent: mode === 'fresh' ? freshAgent : agent,
      preview,
      metadata: { executionSession: mode === 'fresh' ? 'fresh' : 'current' },
      platformId: 'web',
    }));
    (server as any).sessionManager = { switchExecutionSession: switchSession };
    const previewReset = rs.spyOn((server as any)._mjpegHandler, 'reset');
    try {
      const input = { ...plan(), sessionMode: 'fresh' };
      handler(server, 'post', '/scenario-runs')({ body: input }, response());
      await until(() => status().run.status === 'waiting');
      expect(status().isolatedSession).toBe(true);
      expect(status().run.sessionMode).toBe('fresh');
      expect((server as any)._activeConnection.agent).toBe(freshAgent);
      expect(previewReset).toHaveBeenCalled();
      const freshStream = server.getRuntimeInfo().preview?.mjpegPath;
      expect(freshStream).not.toBe(originalStream);
      expect(freshStream).toContain('fps=15');
      expect(freshStream).toContain(
        `previewSession=${status().previewSessionId}`,
      );
      expect(server.getRuntimeInfo().preview?.mjpegPath).toBe(freshStream);
      const blocked = response();
      await handler(
        server,
        'post',
        '/scenario-runs/session/restore',
      )({}, blocked);
      expect(blocked.statusCode).toBe(409);
      handler(
        server,
        'post',
        '/scenario-runs/:id/:action',
      )(
        {
          params: { id: status().run.id, action: 'next' },
          body: { scriptIndex: 1 },
        },
        response(),
      );
      await until(() => !status().busy);
      expect(status().run.status).toBe('completed');
      expect(switchSession).toHaveBeenCalledTimes(1);
      expect(status().isolatedSession).toBe(true);
      const restored = response();
      await handler(
        server,
        'post',
        '/scenario-runs/session/restore',
      )({}, restored);
      expect(restored.statusCode).toBe(200);
      expect(status().isolatedSession).toBe(false);
      const restoredStream = server.getRuntimeInfo().preview?.mjpegPath;
      expect(restoredStream).not.toBe(freshStream);
      expect(restoredStream).not.toBe(originalStream);
      expect(restored.body.previewSessionId).toBe(status().previewSessionId);
      expect((server as any)._activeConnection.agent).toBe(agent);
      expect(switchSession).toHaveBeenLastCalledWith('restore');
    } finally {
      await server.close();
    }
  });
  test('fresh browser startup failure releases the lock without executing steps', async () => {
    const { server, agent, status } = await setup();
    (server as any).sessionManager = {
      switchExecutionSession: rs.fn(async () => {
        throw new Error('Launch failed');
      }),
    };
    try {
      handler(
        server,
        'post',
        '/scenario-runs',
      )({ body: { ...plan(), sessionMode: 'fresh' } }, response());
      await until(() => !status().busy);
      expect(status().run.status).toBe('failed');
      expect(status().run.error).toBe('Launch failed');
      expect(agent.aiAssert).not.toHaveBeenCalled();
      expect(agent.destroy).not.toHaveBeenCalled();
      expect(status().isolatedSession).toBe(false);
    } finally {
      await server.close();
    }
  });
  test('reserves the session, rejects concurrent work and keeps it locked while waiting for next', async () => {
    const { server, agent, status } = await setup();
    try {
      const start = response();
      handler(server, 'post', '/scenario-runs')({ body: plan() }, start);
      expect(start.statusCode).toBe(202);
      const duplicate = response();
      handler(server, 'post', '/scenario-runs')({ body: plan() }, duplicate);
      expect(duplicate.statusCode).toBe(409);
      for (const path of [
        '/execute',
        '/interact',
        '/recorder/start',
        '/config',
      ]) {
        const res = response();
        await handler(server, 'post', path)({ body: {} }, res);
        expect(res.statusCode).toBe(409);
      }
      await until(() => status().run.status === 'waiting');
      expect(status().busy).toBe(true);
      expect(agent.aiAssert).toHaveBeenCalledTimes(1);
      const stale = response();
      handler(
        server,
        'post',
        '/scenario-runs/:id/:action',
      )(
        {
          params: { id: start.body.run.id, action: 'next' },
          body: { scriptIndex: 0 },
        },
        stale,
      );
      expect(stale.statusCode).toBe(409);
      const next = response();
      handler(
        server,
        'post',
        '/scenario-runs/:id/:action',
      )(
        {
          params: { id: start.body.run.id, action: 'next' },
          body: { scriptIndex: 1 },
        },
        next,
      );
      await until(() => !status().busy);
      expect(status().run.status).toBe('completed');
      expect(agent.aiAssert).toHaveBeenCalledTimes(2);
      await until(() => status().run.summary?.status === 'completed');
      expect(status().run.summary.text).toBe('Execution reviewed.');
      expect(status().run.scripts[0].steps[0].status).toBe('passed');
    } finally {
      await server.close();
    }
  });
  test('retains a failed assertion and blocks the next dependent script', async () => {
    const { server, agent, status } = await setup();
    agent.aiAssert.mockResolvedValue({
      pass: false,
      thought: 'Wrong quantity',
    });
    try {
      handler(server, 'post', '/scenario-runs')({ body: plan() }, response());
      await until(() => !status().busy);
      expect(status().run.status).toBe('blocked');
      expect(status().run.error).toBe('Required order is missing');
      expect(agent.aiAssert).toHaveBeenCalledTimes(1);
      expect(status().run.scripts[1].status).toBe('blocked');
      await until(() => status().run.summary?.status === 'completed');
      expect(status().run.scripts[0].steps[0].error).toBe('Wrong quantity');
      expect(status().run.scripts[1].steps[0].status).toBe('pending');
    } finally {
      await server.close();
    }
  });
  test('summary failure does not change results or lock the browser', async () => {
    const { server, status } = await setup();
    rs.mocked(generateScenarioSummary).mockRejectedValueOnce(
      new Error('Model unavailable'),
    );
    try {
      const input = plan();
      input.scripts = [input.scripts[0]];
      handler(server, 'post', '/scenario-runs')({ body: input }, response());
      await until(() => status().run.summary?.status === 'failed');
      expect(status().run.status).toBe('completed');
      expect(status().run.error).toBeUndefined();
      expect(status().busy).toBe(false);
      await until(() => rs.mocked(saveScenarioReport).mock.calls.length > 0);
      expect(status().run.summary.format).toBe('markdown');
    } finally {
      await server.close();
    }
  });
  test('startup failure releases the session and stop cancels a manual wait', async () => {
    const { server, status } = await setup();
    try {
      rs.mocked(connectScenarioPage).mockRejectedValueOnce(
        new Error('Browser disconnected'),
      );
      handler(server, 'post', '/scenario-runs')({ body: plan() }, response());
      await until(() => !status().busy);
      expect(status().run.status).toBe('failed');
      handler(server, 'post', '/scenario-runs')({ body: plan() }, response());
      await until(() => status().run.status === 'waiting');
      handler(
        server,
        'post',
        '/scenario-runs/:id/:action',
      )(
        { params: { id: status().run.id, action: 'stop' }, body: {} },
        response(),
      );
      await until(() => !status().busy);
      expect(status().run.status).toBe('stopped');
    } finally {
      await server.close();
    }
  });
});
