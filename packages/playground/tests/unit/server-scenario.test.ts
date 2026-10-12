import { describe, expect, rs, test } from '@rstest/core';
import type { ScenarioRunInput } from '../../src/scenario-contract';
import { connectScenarioPage } from '../../src/scenario-native';
import { PlaygroundServer } from '../../src/server';

rs.mock('../../src/scenario-native', () => ({
  connectScenarioPage: rs.fn(async () => ({ page: {}, close: async () => {} })),
  executeScenarioNative: rs.fn(async () => {}),
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
