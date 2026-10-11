import {
  PlaygroundThemeProvider,
  usePlaygroundController,
} from '@midscene/playground-app';
import type { StudioPlatformId } from '@shared/electron-contract';
import { Form } from 'antd';
import type { PropsWithChildren } from 'react';
import { useMemo } from 'react';
import { loadSavedWebPages, webPageFormValues } from './saved-web-pages';
import type {
  DiscoveredDevicesByPlatform,
  DiscoveryErrorsByPlatform,
} from './types';
import { StudioPlaygroundContext } from './useStudioPlayground';

const DEFAULT_PLATFORM_ID: StudioPlatformId = 'web';

interface StudioPlaygroundReadyProviderProps {
  discoveredDevices?: DiscoveredDevicesByPlatform;
  discoveryErrors?: DiscoveryErrorsByPlatform;
  refreshDiscoveredDevices: () => Promise<void>;
  restartPlayground: () => Promise<void>;
  setDiscoveryPollingPaused: (paused: boolean) => void;
  serverUrl: string;
}

export default function StudioPlaygroundReadyProvider({
  children,
  discoveredDevices,
  discoveryErrors,
  refreshDiscoveredDevices,
  restartPlayground,
  setDiscoveryPollingPaused,
  serverUrl,
}: PropsWithChildren<StudioPlaygroundReadyProviderProps>) {
  const initialFormValues = useMemo(
    () => ({
      ...webPageFormValues(loadSavedWebPages()[0]),
      platformId: DEFAULT_PLATFORM_ID,
    }),
    [],
  );
  const controller = usePlaygroundController({ initialFormValues, serverUrl });

  const contextValue = useMemo(
    () => ({
      phase: 'ready' as const,
      serverUrl,
      controller,
      restartPlayground,
      refreshDiscoveredDevices,
      setDiscoveryPollingPaused,
      discoveredDevices,
      discoveryErrors,
    }),
    [
      controller,
      discoveredDevices,
      discoveryErrors,
      refreshDiscoveredDevices,
      restartPlayground,
      setDiscoveryPollingPaused,
      serverUrl,
    ],
  );

  return (
    <PlaygroundThemeProvider>
      <StudioPlaygroundContext.Provider value={contextValue}>
        <Form form={controller.state.form} component={false} />
        {children}
      </StudioPlaygroundContext.Provider>
    </PlaygroundThemeProvider>
  );
}
