import { describe, expect, rs, test } from '@rstest/core';
import type { ScenarioRunInput } from '../../src/scenario-contract';
import { connectScenarioPage } from '../../src/scenario-native';
import { generateScenarioSummary } from '../../src/scenario-summary';
import { PlaygroundServer } from '../../src/server';

rs.mock('../../src/scenario-native', () => ({
  connectScenarioPage: rs.fn(async () => ({ page: {}, close: async () => {} })),
  executeScenarioNative: rs.fn(async () => {}),
}));
rs.mock('../../src/scenario-summary', () => ({
  generateScenarioSummary: rs.fn(async () => 'Execution reviewed.'),
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
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Scenario did not settle');
}
async function setup() {
  const agent = {
    interface: { actionSpace: () => [], interfaceType: 'puppeteer' },
    aiAssert: rs.fn(async () => ({ pass: true, thought: '' })),
    destroy: rs.fn(async () => {}),
    resetDump: rs.fn(),
  };
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
  test('reports a failed Agent assertion and releases the lock without running the next script', async () => {
    const { server, agent, status } = await setup();
    agent.aiAssert.mockResolvedValue({
      pass: false,
      thought: 'Wrong quantity',
    });
    try {
      handler(server, 'post', '/scenario-runs')({ body: plan() }, response());
      await until(() => !status().busy);
      expect(status().run.status).toBe('failed');
      expect(status().run.error).toBe('Wrong quantity');
      expect(agent.aiAssert).toHaveBeenCalledTimes(1);
      expect(status().run.scripts[1].status).toBe('pending');
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
