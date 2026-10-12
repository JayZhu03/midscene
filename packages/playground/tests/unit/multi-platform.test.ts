import { describe, expect, rs, test } from '@rstest/core';
import { prepareMultiPlatformPlayground } from '../../src/multi-platform';

function createAgent(interfaceType: string) {
  return {
    interface: {
      interfaceType,
      describe: () => `${interfaceType} interface`,
      actionSpace: () => [],
    },
    destroy: rs.fn(),
  } as any;
}

describe('prepareMultiPlatformPlayground', () => {
  test('forwards execution-session switching to the active platform with preview metadata', async () => {
    const agent = createAgent('web');
    const switchSession = rs.fn(async () => ({
      agent,
      metadata: { executionSession: 'fresh' },
    }));
    const prepared = await prepareMultiPlatformPlayground([
      {
        id: 'web',
        label: 'Web',
        prepare: async () => ({
          platformId: 'web',
          title: 'Web',
          preview: { kind: 'mjpeg' },
          sessionManager: {
            createSession: async () => ({ agent }),
            switchExecutionSession: switchSession,
          },
        }),
      },
    ]);
    await prepared.sessionManager!.createSession({ platformId: 'web' });
    const result =
      await prepared.sessionManager!.switchExecutionSession!('fresh');
    expect(switchSession).toHaveBeenCalledWith('fresh');
    expect(result).toMatchObject({
      platformId: 'web',
      preview: { kind: 'mjpeg' },
      metadata: { executionSession: 'fresh' },
    });
  });
  test('exposes platform registry metadata and routes child sessions', async () => {
    const childGetSetupSchema = rs.fn(async () => ({
      title: 'Connect Android',
      fields: [
        {
          key: 'deviceId',
          label: 'Device',
          type: 'select' as const,
        },
      ],
    }));
    const childCreateSession = rs.fn(
      async (input?: Record<string, unknown>) => ({
        agent: createAgent('android'),
        displayName: String(input?.deviceId),
        metadata: {
          deviceId: input?.deviceId,
        },
      }),
    );

    const prepared = await prepareMultiPlatformPlayground(
      [
        {
          id: 'android',
          label: 'Android',
          description: 'Android device',
          prepare: async () => ({
            platformId: 'android',
            title: 'Android Playground',
            description: 'Android descriptor',
            sessionManager: {
              getSetupSchema: childGetSetupSchema,
              createSession: childCreateSession,
            },
          }),
        },
      ],
      {
        title: 'Unified Playground',
        platformId: 'unified',
      },
    );

    expect(prepared.platformId).toBe('unified');

    const setup = await prepared.sessionManager!.getSetupSchema!();
    expect(setup).toMatchObject({
      platformSelector: {
        fieldKey: 'platformId',
        variant: 'cards',
      },
      platformRegistry: [
        {
          id: 'android',
          label: 'Android',
          description: 'Android device',
        },
      ],
    });

    const childSetup = await prepared.sessionManager!.getSetupSchema!({
      platformId: 'android',
    });
    expect(childSetup).toMatchObject({
      fields: [
        { key: 'platformId', defaultValue: 'android' },
        { key: 'android.deviceId', label: 'Device' },
      ],
    });

    const created = await prepared.sessionManager?.createSession({
      platformId: 'android',
      'android.deviceId': 'SERIAL123',
    });
    expect(childCreateSession).toHaveBeenCalledWith({
      deviceId: 'SERIAL123',
    });
    expect(created).toMatchObject({
      platformId: 'android',
      title: 'Android Playground',
      platformDescription: 'Android descriptor',
      metadata: {
        deviceId: 'SERIAL123',
      },
    });
  });
});
