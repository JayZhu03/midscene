import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, rs, test } from '@rstest/core';
import type { Page } from 'playwright-core';
import {
  SCENARIO_PAGE_NOT_READY,
  observeScenarioReadiness,
} from '../../src/scenario-readiness';

function fixture() {
  const page = new EventEmitter();
  const state = { loading: false, content: '总 1 条' };
  const evaluate = rs.fn(async () => ({ ...state }));
  Object.assign(page, { evaluate, url: () => 'https://example.test/orders' });
  const readiness = observeScenarioReadiness(page as unknown as Page);
  return { page, state, evaluate, readiness };
}

describe('scenario assertion readiness', () => {
  test('report capture waits for asynchronous results without waiting for an expected value', async () => {
    const { page, state, readiness } = fixture();
    const request = { resourceType: () => 'xhr' };
    page.emit('request', request);
    const settled = rs.fn();
    const capture = readiness
      .waitForEvidence(new AbortController().signal)
      .then(settled);
    await delay(180);
    expect(settled).not.toHaveBeenCalled();
    state.content = '选择工序';
    page.emit('requestfinished', request);
    await capture;
    expect(settled).toHaveBeenCalledWith(true);
    readiness.dispose();
  });

  test('report capture has a bounded wait and does not certify an unsettled page', async () => {
    const { state, readiness } = fixture();
    state.loading = true;
    expect(
      await readiness.waitForEvidence(new AbortController().signal, 60),
    ).toBe(false);
    readiness.dispose();
  });

  test('stopping report capture still propagates cancellation', async () => {
    const { evaluate, readiness } = fixture();
    evaluate.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const capture = expect(
      readiness.waitForEvidence(controller.signal),
    ).rejects.toThrow('Stopped');
    controller.abort(new Error('Stopped'));
    await capture;
    readiness.dispose();
  });

  test('waits for a query started before the assertion and its final rendered data', async () => {
    const { page, state, readiness } = fixture();
    const request = { resourceType: () => 'xhr' };
    page.emit('request', request);
    const settled = rs.fn();
    const waiting = readiness
      .wait(new AbortController().signal, 2000, 30)
      .then(settled);
    await delay(150);
    expect(settled).not.toHaveBeenCalled();
    state.loading = true;
    page.emit('requestfinished', request);
    await delay(150);
    expect(settled).not.toHaveBeenCalled();
    state.loading = false;
    state.content = '总 2165 条';
    await waiting;
    expect(settled).toHaveBeenCalledTimes(1);
    readiness.dispose();
    expect(page.listenerCount('request')).toBe(0);
    expect(page.listenerCount('requestfinished')).toBe(0);
    expect(page.listenerCount('requestfailed')).toBe(0);
  });

  test('does not wait for an expected count or hide an actual mismatch', async () => {
    const { state, readiness } = fixture();
    await readiness.wait(new AbortController().signal, 1000, 30);
    expect(state.content).toBe('总 1 条');
    readiness.dispose();
  });

  test('times out when the spinner stays visible', async () => {
    const { state, readiness } = fixture();
    state.loading = true;
    await expect(
      readiness.wait(new AbortController().signal, 150, 30),
    ).rejects.toThrow(SCENARIO_PAGE_NOT_READY);
    readiness.dispose();
  });

  test('timeout and stop also interrupt an unresponsive renderer', async () => {
    const { evaluate, readiness } = fixture();
    evaluate.mockImplementation(() => new Promise(() => {}));
    await expect(
      readiness.wait(new AbortController().signal, 50, 30),
    ).rejects.toThrow(SCENARIO_PAGE_NOT_READY);
    const controller = new AbortController();
    const stopped = expect(
      readiness.wait(controller.signal, 2000, 30),
    ).rejects.toThrow('Stopped');
    controller.abort(new Error('Stopped'));
    await stopped;
    readiness.dispose();
  });

  test('ignores streaming resources and releases failed queries', async () => {
    const { page, readiness } = fixture();
    const request = { resourceType: () => 'fetch' };
    page.emit('request', { resourceType: () => 'eventsource' });
    page.emit('request', request);
    page.emit('requestfailed', request);
    await readiness.wait(new AbortController().signal, 1000, 30);
    readiness.dispose();
  });

  test('rechecks the replacement document when navigation destroys its context', async () => {
    const { evaluate, readiness } = fixture();
    evaluate.mockRejectedValueOnce(
      new Error(
        'Execution context was destroyed, most likely because of a navigation',
      ),
    );
    await readiness.wait(new AbortController().signal, 1000, 30);
    expect(evaluate.mock.calls.length).toBeGreaterThan(1);
    readiness.dispose();
  });
});
