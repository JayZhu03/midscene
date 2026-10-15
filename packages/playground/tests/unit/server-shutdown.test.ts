import type { Server } from 'node:http';
import { expect, rs, test } from '@rstest/core';
import { PlaygroundServer } from '../../src/server';

function setup() {
  const destroy = rs.fn(async () => {});
  const server = new PlaygroundServer({
    interface: { actionSpace: () => [] },
    destroy,
  } as any);
  return { server, state: server as any, destroy };
}

test('cancels active work and closes HTTP streams before waiting for cleanup', async () => {
  const { server, state, destroy } = setup();
  const task = new AbortController();
  const summary = new AbortController();
  state.taskAbortControllers = { task };
  state.scenarioSummaryAbort = summary;
  state.scenarioCompletion = new Promise<void>((resolve) => {
    task.signal.addEventListener('abort', () => resolve(), { once: true });
  });
  state.scenarioSummaryCompletion = new Promise<void>((resolve) => {
    summary.signal.addEventListener('abort', () => resolve(), { once: true });
  });
  const stop = rs.fn();
  state.scenarioRunner = { stop };

  let closeCallback!: () => void;
  const closeConnections = rs.fn(() => {
    expect(task.signal.aborted).toBe(true);
    expect(summary.signal.aborted).toBe(true);
    expect(destroy).not.toHaveBeenCalled();
    closeCallback();
  });
  server.server = {
    close: (callback: () => void) => {
      closeCallback = callback;
    },
    closeAllConnections: closeConnections,
  } as unknown as Server;

  await server.close();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(closeConnections).toHaveBeenCalledTimes(1);
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(server.server).toBeUndefined();
});

test('concurrent and repeated close requests share the same cleanup', async () => {
  const { server, destroy } = setup();
  let finish!: () => void;
  destroy.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const first = server.close();
  expect(server.close()).toBe(first);
  await Promise.resolve();
  await Promise.resolve();
  expect(destroy).toHaveBeenCalledTimes(1);
  finish();
  await first;
  await server.close();
  expect(destroy).toHaveBeenCalledTimes(1);
});

test('releases the HTTP server even when device cleanup fails', async () => {
  const { server, destroy } = setup();
  await server.launch(6199);
  const httpServer = server.server!;
  destroy.mockRejectedValue(new Error('Device disconnected'));
  await server.close();
  expect(httpServer.close).toHaveBeenCalledTimes(1);
  expect(server.server).toBeUndefined();
});
