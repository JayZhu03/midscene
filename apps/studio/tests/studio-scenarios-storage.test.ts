// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SCENARIOS_STORAGE_KEY,
  loadStudioScenarios,
  saveStudioScenarios,
} from '../src/renderer/components/StudioScenarios/storage';

const debug = vi.hoisted(() => vi.fn());
vi.mock('@midscene/shared/logger', () => ({ getDebug: () => debug }));

const scenario = {
  id: 'stable-id',
  name: 'Login',
  description: '',
  createdAt: 100,
  updatedAt: 200,
};

describe('local scenario storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    debug.mockClear();
  });

  it('roundtrips stable ids and timestamps while trimming text', () => {
    saveStudioScenarios([
      { ...scenario, name: ' Login ', description: ' Intro ' },
    ]);
    expect(loadStudioScenarios()).toEqual([
      { ...scenario, description: 'Intro' },
    ]);
  });

  it.each([
    '{broken secret content',
    'null',
    '{}',
    JSON.stringify([{ ...scenario, name: ' ' }]),
    JSON.stringify([{ ...scenario, name: 'n'.repeat(81) }]),
    JSON.stringify([{ ...scenario, description: 'd'.repeat(501) }]),
    JSON.stringify([{ ...scenario, createdAt: -1 }]),
    JSON.stringify([{ ...scenario, updatedAt: 50 }]),
    JSON.stringify([{ ...scenario, id: 5 }]),
    JSON.stringify([scenario, scenario]),
  ])('recovers invalid data without logging stored contents: %s', (stored) => {
    localStorage.setItem(SCENARIOS_STORAGE_KEY, stored);
    expect(loadStudioScenarios()).toEqual([]);
    expect(debug).toHaveBeenCalledWith(
      'Unable to read local scenarios; using an empty list.',
    );
  });

  it('accepts the text limits and empty lists', () => {
    saveStudioScenarios([
      { ...scenario, name: 'n'.repeat(80), description: 'd'.repeat(500) },
    ]);
    expect(loadStudioScenarios()).toHaveLength(1);
    saveStudioScenarios([]);
    expect(loadStudioScenarios()).toEqual([]);
  });

  it('rejects invalid writes without replacing saved data', () => {
    saveStudioScenarios([scenario]);
    expect(() => saveStudioScenarios([{ ...scenario, name: '' }])).toThrow(
      'Invalid scenario storage.',
    );
    expect(loadStudioScenarios()).toEqual([scenario]);
  });

  it('handles read denial without including exception content in logs', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('private content', 'SecurityError');
    });
    expect(loadStudioScenarios()).toEqual([]);
    expect(debug).toHaveBeenCalledWith(
      'Unable to read local scenarios; using an empty list.',
    );
  });

  it.each([
    ['QuotaExceededError', 'Local storage is full. Unable to save.'],
    ['SecurityError', 'Local storage is unavailable. Unable to save.'],
    ['UnknownError', 'Unable to save scenarios locally. Please retry.'],
  ])('surfaces %s writes as short errors', (name, message) => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('private content', name);
    });
    expect(() => saveStudioScenarios([scenario])).toThrow(message);
  });
});
