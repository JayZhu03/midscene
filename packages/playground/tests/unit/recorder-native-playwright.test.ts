import { describe, expect, it, rs } from '@rstest/core';
import {
  buildPlaywrightRecorderCaptureScript,
  capturePlaywrightRecorderTarget,
} from '../../src/recorder-native-playwright';

describe('Playwright recorder capture adapter', () => {
  it('keeps semantic capture fast and excludes typed secrets', async () => {
    const target = { locator: { selector: '#order' } };
    const evaluate = rs.fn().mockResolvedValue(target);
    expect(
      await capturePlaywrightRecorderTarget(evaluate, {
        actionType: 'Input',
        value: 'private-password',
      }),
    ).toEqual(target);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0][0]).not.toContain('private-password');
    expect(evaluate.mock.calls[0][0]).not.toContain('class InjectedScript');
  });

  it('installs the pinned generator only when an endpoint needs it', async () => {
    const target = {
      locator: { selector: '#source' },
      dropTarget: { locator: { selector: '#drop' } },
    };
    const evaluate = rs
      .fn()
      .mockResolvedValueOnce({
        locator: { selector: '#source' },
        dropTarget: { error: 'PLAYWRIGHT_GENERATOR_REQUIRED' },
      })
      .mockResolvedValueOnce(target);
    expect(
      await capturePlaywrightRecorderTarget(evaluate, {
        actionType: 'DragAndDrop',
        endX: 120,
        endY: 50,
      }),
    ).toEqual(target);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate.mock.calls[1][0]).toContain('var InjectedScript = class');
    expect(evaluate.mock.calls[1][0]).not.toContain(
      '__pw_recorderPerformAction',
    );
  });

  it('does not retry arbitrary capture failures or copy input values into installation', async () => {
    const evaluate = rs
      .fn()
      .mockResolvedValue({ error: '未找到可定位的元素。' });
    await capturePlaywrightRecorderTarget(evaluate, { actionType: 'Tap' });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(
      buildPlaywrightRecorderCaptureScript(
        { actionType: 'Input', value: 'private-password' },
        true,
      ),
    ).not.toContain('private-password');
  });
});
