import { PlaygroundPreview } from '@midscene/playground-app';
import { getDebug } from '@midscene/shared/logger';
import type { PlaygroundExecutionStatus } from '@midscene/visualizer';
import type { StudioPlatformId } from '@shared/electron-contract';
import type { WebSiteIcon } from '@shared/web-site-icon';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { assetUrls } from '../../assets';
import { t, useStudioLanguage } from '../../i18n';
import {
  type StudioPreviewConnectionState,
  shouldPauseDiscoveryPollingDuringPreview,
} from '../../playground/preview-discovery';
import {
  type SavedWebPage,
  loadSavedWebPages,
  saveWebPage,
  savedWebPageDisplay,
  updateWebPageIcon,
  useSavedWebPages,
} from '../../playground/saved-web-pages';
import {
  buildDeviceSelectionFormValues,
  buildStudioSidebarDeviceBuckets,
  mergeSidebarDeviceBucketsWithDiscovery,
  resolveConnectedDeviceId,
  resolveConnectedDeviceLabel,
  resolveSelectedDeviceId,
} from '../../playground/selectors';
import { useStudioPlayground } from '../../playground/useStudioPlayground';
import { type StudioMode, StudioModeTab } from '../../recorder/types';
import { useOptionalStudioRecorder } from '../../recorder/useStudioRecorder';
import ConnectingPreview from '../ConnectingPreview';
import ConnectionFailedPreview from '../ConnectionFailedPreview';
import DisconnectedPreview from '../DisconnectedPreview';
import type { ConnectionStatus } from '../PlaygroundShell';
import type { ShellActiveView } from '../ShellLayout/types';
import StudioModePanel from '../StudioModePanel';
import type { StudioRightPanelView } from '../StudioRightPanel';
import { canNavigateStudio } from '../StudioScenarios/navigation';
import { useScenarioExecutionBusy } from '../StudioScenarios/useScenarioExecution';
import { StudioWorkspace, StudioWorkspaceSwitch } from '../StudioWorkspace';
import type {
  StudioWorkbenchMenu,
  StudioWorkspaceMode,
} from '../StudioWorkspace/preferences';
import { WebSiteIcon as WebsiteIcon } from '../WebSiteIcon';
import { DeviceList } from './DeviceList';
import { MobilePreviewFrame } from './MobilePreviewFrame';
import {
  resolveStudioPreviewPlatform,
  resolveStudioWebPreviewAspectRatio,
  shouldEnableMobilePreviewFrame,
  shouldUseDesktopPreviewPadding,
} from './preview-layout';

const debugWebNavigation = getDebug('studio:web-navigation', { console: true });
const STUDIO_MODE_PANEL_WIDTH = 340;
const noopStudioModeChange = () => {};
const idleTimelineExecutionStatus: PlaygroundExecutionStatus = {
  running: false,
  stoppable: false,
  stop: () => undefined,
};

export interface MainContentProps {
  activeView: ShellActiveView;
  workspaceMode?: StudioWorkspaceMode;
  workbenchMenu?: StudioWorkbenchMenu;
  onWorkspaceModeChange?: (mode: StudioWorkspaceMode) => void;
  onWorkbenchMenuChange?: (menu: StudioWorkbenchMenu) => void;
  /** Shell-level "user just clicked this platform" hint. Bridges the gap
   * between a click in Sidebar (or Overview cards) and antd Form.useWatch
   * actually propagating the new platformId — without it, ConnectingPreview
   * renders the Android phone icon for one frame on PC/Web. */
  pendingCreatePlatform?: StudioPlatformId;
  /** Lets MainContent push the same hint back to the shell when it owns
   * the click path (Overview Open Page / iOS form / Computer card). */
  onPendingCreatePlatformChange?: (
    platform: StudioPlatformId | undefined,
  ) => void;
  onSelectDeviceView?: () => void;
  onSelectOverview?: () => void;
  /**
   * False when the required model connection env cannot be resolved; the
   * Overview surfaces a banner pointing to the env modal in that case.
   */
  modelConfigComplete?: boolean;
  /** Raw env text — previewed inline in the Model Config card. */
  modelEnvText?: string;
  /** Opens the model env config modal anchored in the shell. */
  onOpenEnvModal?: () => void;
  studioMode?: StudioMode;
  onStudioModeChange?: (mode: StudioMode) => void;
  onCloseStudioRightPanel?: () => void;
  onOpenStudioRightPanel?: (view: StudioRightPanelView) => void;
  /** A generated Markdown detail panel is open beside Record or Replay mode. */
  floatingStudioModePanel?: boolean;
  /** Left inset reserved by the collapsed shell titlebar controls. */
  titlebarInsetLeft?: number;
  /** Right inset reserved by Windows native window controls. */
  titlebarInsetRight?: number;
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  useStudioLanguage();

  return (
    <svg
      aria-hidden="true"
      className={spinning ? 'animate-spin' : undefined}
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
      <path
        d="M13.5 2.5v3h-3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function BackIcon() {
  useStudioLanguage();

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      viewBox="0 0 16 16"
      width="15"
    >
      <path
        d="M9.8 3.2 5 8l4.8 4.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ForwardIcon() {
  useStudioLanguage();

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      viewBox="0 0 16 16"
      width="15"
    >
      <path
        d="M6.2 3.2 11 8l-4.8 4.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function StopIcon() {
  useStudioLanguage();

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="13"
      viewBox="0 0 16 16"
      width="13"
    >
      <rect
        height="8.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
        width="8.5"
        x="3.75"
        y="3.75"
      />
    </svg>
  );
}

function resolvePlatformLogo(platform?: string): string {
  switch (platform) {
    case 'computer':
      return assetUrls.main.platformPc;
    case 'web':
      return assetUrls.main.platformWeb;
    case 'ios':
      return assetUrls.main.platformIos;
    case 'harmony':
      return assetUrls.main.platformHarmony;
    case 'android':
      return assetUrls.main.platformAndroid;
    default:
      return assetUrls.main.platformWeb;
  }
}

function getPreviewConnectingLabel(platform?: string): string {
  switch (platform) {
    case 'web':
      return t('Opening Web page…');
    case 'computer':
      return t('Preparing computer connection…');
    case 'ios':
      return t('Preparing iOS device connection…');
    case 'harmony':
      return t('Preparing HarmonyOS device connection…');
    case 'android':
      return t('Preparing Android device connection…');
    default:
      return t('Opening Web page…');
  }
}

function getDisconnectedPreviewTitle(platform?: string): string {
  switch (platform) {
    case 'web':
      return t('Open Web Page');
    case 'computer':
      return t('Connect Computer');
    case 'ios':
      return t('Connect iOS Device');
    case 'harmony':
      return t('Connect HarmonyOS Device');
    case 'android':
      return t('Connect Android Device');
    default:
      return t('Open test page');
  }
}

function WebNavigationButton({
  'aria-label': ariaLabel,
  disabled,
  onClick,
  children,
}: {
  'aria-label': string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  useStudioLanguage();

  return (
    <button
      aria-label={ariaLabel}
      className="app-no-drag flex h-[28px] w-[28px] cursor-pointer appearance-none items-center justify-center rounded-[7px] border-0 bg-transparent p-0 text-text-secondary shadow-none transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      title={ariaLabel}
      type="button"
    >
      {children}
    </button>
  );
}

export default function MainContent({
  activeView,
  workspaceMode = 'original',
  workbenchMenu = 'scenarios',
  onWorkspaceModeChange,
  onWorkbenchMenuChange,
  pendingCreatePlatform,
  onPendingCreatePlatformChange,
  onSelectDeviceView,
  onSelectOverview,
  modelConfigComplete = true,
  modelEnvText,
  onOpenEnvModal,
  onCloseStudioRightPanel,
  onOpenStudioRightPanel,
  floatingStudioModePanel = false,
  onStudioModeChange,
  studioMode,
  titlebarInsetLeft = 0,
  titlebarInsetRight = 0,
}: MainContentProps) {
  useStudioLanguage();

  const studioPlayground = useStudioPlayground();
  const recorder = useOptionalStudioRecorder();
  const [previewStatus, setPreviewStatus] =
    useState<StudioPreviewConnectionState>(null);
  // Connected device's intrinsic screen size, reported by PreviewRenderer
  // once `/interface-info` lands. We feed its aspect ratio into the
  // mobile preview frame so the rounded border tightly hugs the canvas
  // instead of letterboxing with a hardcoded 9:19.5 assumption.
  const [previewDeviceSize, setPreviewDeviceSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const previewAspectRatio =
    previewDeviceSize &&
    previewDeviceSize.width > 0 &&
    previewDeviceSize.height > 0
      ? previewDeviceSize.width / previewDeviceSize.height
      : undefined;
  const [previewStatusText, setPreviewStatusText] = useState<string | null>(
    null,
  );
  const [webNavigationBusyAction, setWebNavigationBusyAction] = useState<
    'GoBack' | 'GoForward' | 'Stop' | 'Reload' | null
  >(null);
  const [webIsLoading, setWebIsLoading] = useState(false);
  const [studioModeHeaderActions, setStudioModeHeaderActions] =
    useState<ReactNode>();
  const [timelineExecutionStatus, setTimelineExecutionStatus] =
    useState<PlaygroundExecutionStatus>(idleTimelineExecutionStatus);
  const setPendingCreatePlatform = onPendingCreatePlatformChange;
  const activeStudioMode = studioMode ?? StudioModeTab.Record;
  const syncStudioModeHeaderActions = useCallback(
    (header: { actions?: ReactNode }) => {
      setStudioModeHeaderActions((current) =>
        current === header.actions ? current : header.actions,
      );
    },
    [],
  );
  const handleStudioModeChange = onStudioModeChange ?? noopStudioModeChange;
  const isReady = studioPlayground.phase === 'ready';
  const isConnected = isReady
    ? studioPlayground.controller.state.sessionViewState.connected
    : false;
  const runtimeInfo =
    studioPlayground.phase === 'ready'
      ? studioPlayground.controller.state.runtimeInfo
      : null;
  const previewFormValues: Record<string, unknown> =
    studioPlayground.phase === 'ready'
      ? studioPlayground.controller.state.formValues
      : {};
  const connectedDeviceId = isReady
    ? resolveConnectedDeviceId(runtimeInfo)
    : undefined;
  const selectedDeviceId = isReady
    ? resolveSelectedDeviceId(previewFormValues)
    : undefined;
  const previewDeviceId = connectedDeviceId ?? selectedDeviceId;
  const selectedDeviceLabel = (() => {
    if (!isReady || !selectedDeviceId) {
      return undefined;
    }
    const sessionBuckets = buildStudioSidebarDeviceBuckets({
      formValues: previewFormValues,
      runtimeInfo,
      targets: studioPlayground.controller.state.sessionSetup?.targets || [],
    });
    const mergedBuckets = mergeSidebarDeviceBucketsWithDiscovery(
      sessionBuckets,
      studioPlayground.discoveredDevices,
    );
    const selectedDevice = Object.values(mergedBuckets)
      .flat()
      .find((device) => device.selected || device.id === selectedDeviceId);
    return selectedDevice?.label || selectedDeviceId;
  })();
  const connectedDeviceLabel = isReady
    ? resolveConnectedDeviceLabel(runtimeInfo, { emptyLabel: '' })
    : undefined;
  const savedPages = useSavedWebPages();
  const webDisplay = savedWebPageDisplay(
    runtimeInfo?.metadata?.url ?? previewFormValues['web.url'],
    savedPages,
  );
  const lastKnownDeviceLabelRef = useRef<string | undefined>(undefined);
  const resolvedDeviceLabel =
    (runtimeInfo?.platformId === 'web' ? webDisplay?.name : undefined) ||
    (isConnected ? connectedDeviceLabel : selectedDeviceLabel) ||
    selectedDeviceLabel ||
    connectedDeviceLabel;
  if (resolvedDeviceLabel) {
    lastKnownDeviceLabelRef.current = resolvedDeviceLabel;
  }
  const deviceLabel =
    studioPlayground.phase === 'error'
      ? t('Runtime Error')
      : isReady
        ? resolvedDeviceLabel ||
          lastKnownDeviceLabelRef.current ||
          t('No page opened')
        : t('Playground starting');
  const shouldFrameMobilePreview = shouldEnableMobilePreviewFrame(
    runtimeInfo,
    previewFormValues,
    isConnected,
    previewStatus,
  );
  const scenarioExecutionBusy = useScenarioExecutionBusy();
  const previewBoundaryActive =
    Boolean(recorder?.state.isRecording) ||
    timelineExecutionStatus.running ||
    scenarioExecutionBusy;
  const shouldPadDesktopPreview = shouldUseDesktopPreviewPadding(
    runtimeInfo,
    previewFormValues,
  );
  const resolvedPreviewPlatform = resolveStudioPreviewPlatform(
    runtimeInfo,
    previewFormValues,
  );
  const isSessionMutating =
    isReady && studioPlayground.controller.state.sessionMutating;
  // Prefer the platform whichever path has already settled. When we
  // just kicked off a session from Overview, antd's form-watch update
  // hasn't propagated yet — keep the click-time pending platform ahead
  // of stale form/runtime state so the connecting overlay locks onto the
  // correct icon immediately.
  const previewPlatform =
    pendingCreatePlatform && (!isConnected || isSessionMutating)
      ? pendingCreatePlatform
      : (resolvedPreviewPlatform ?? pendingCreatePlatform ?? 'web');
  const webPreviewAspectRatio =
    resolveStudioWebPreviewAspectRatio(previewFormValues);
  const webPreviewCanvasStyle: CSSProperties | undefined =
    previewPlatform === 'web'
      ? ({
          '--studio-web-preview-aspect-ratio': String(webPreviewAspectRatio),
          '--studio-web-preview-height-limited-width': `${webPreviewAspectRatio * 100}cqh`,
          '--studio-web-preview-width-limited-height': `${100 / webPreviewAspectRatio}cqw`,
        } as CSSProperties)
      : undefined;
  const showWebNavigation = isConnected && previewPlatform === 'web';
  const previewConnectingLabel = getPreviewConnectingLabel(previewPlatform);
  const disconnectedPreviewTitle = getDisconnectedPreviewTitle(previewPlatform);
  const isPreviewConnecting =
    isReady && !isConnected && (isSessionMutating || Boolean(selectedDeviceId));
  const disconnectDisabled =
    !isReady || !studioPlayground.controller.state.sessionViewState.connected;
  const previewConnectionFailed =
    previewStatus === 'error' || previewStatus === 'disconnected';
  const connectionStatus: ConnectionStatus =
    previewStatus === 'recovering'
      ? 'recovering'
      : previewConnectionFailed
        ? 'failed'
        : isConnected
          ? 'connected'
          : isPreviewConnecting
            ? 'connecting'
            : 'disconnected';

  const previewHeaderSubInfo: { key: string; text: string }[] = [];
  if (isConnected && previewDeviceId) {
    const idLabel =
      previewPlatform === 'android' || previewPlatform === 'harmony'
        ? `ADB Device: ${previewDeviceId}`
        : previewPlatform === 'computer'
          ? `Display: ${previewDeviceId}`
          : previewPlatform === 'ios'
            ? `WDA: ${previewDeviceId}`
            : previewDeviceId;
    previewHeaderSubInfo.push({ key: 'device-id', text: idLabel });
  }
  if (previewDeviceSize) {
    previewHeaderSubInfo.push({
      key: 'viewport',
      text: `${t('Page size')}: ${previewDeviceSize.width} × ${previewDeviceSize.height}`,
    });
  }
  const pillStatusLabel: Record<ConnectionStatus, string> = {
    connected: t('Live'),
    connecting: 'Loading',
    disconnected: 'Idle',
    recovering: 'Recovering',
    failed: 'Failed',
  };
  // Pill chrome — adopts the imported "Live" tag visual (rounded background,
  // status dot + label) and doubles as the disconnect control. Hover reveals
  // a black tooltip ported from the FloatingLayer mock.
  const pillPalette: Record<
    ConnectionStatus,
    { bg: string; fg: string; dot: string }
  > = {
    connected: {
      bg: 'var(--midscene-status-pill-connected-bg)',
      fg: '#42B56C',
      dot: '#42B56C',
    },
    connecting: {
      bg: 'var(--midscene-status-pill-connecting-bg)',
      fg: '#1A79FF',
      dot: '#1A79FF',
    },
    disconnected: {
      bg: 'var(--midscene-status-pill-disconnected-bg)',
      fg: '#818283',
      dot: '#B6B6B6',
    },
    recovering: { bg: '#FFF4D6', fg: '#B7791F', dot: '#F59E0B' },
    failed: {
      bg: 'var(--midscene-status-pill-failed-bg)',
      fg: '#C0392B',
      dot: '#E53935',
    },
  };
  const pillColors = pillPalette[connectionStatus];
  const stopActiveTimelineExecution = async () => {
    if (
      !timelineExecutionStatus.running ||
      !timelineExecutionStatus.stoppable
    ) {
      return;
    }

    try {
      await timelineExecutionStatus.stop();
    } catch (error) {
      debugWebNavigation('failed to stop active timeline execution: %s', error);
    }
  };

  const stopStudioActivityBeforeSessionDestroy = async () => {
    if (recorder?.state.isRecording) {
      await recorder.stopRecording();
    }
    await stopActiveTimelineExecution();
  };
  const liveStatusPill = (
    <div className="app-no-drag group/disconnect-pill relative flex shrink-0 items-center">
      <button
        aria-label={t('Disconnect')}
        className="inline-flex h-[17px] items-center gap-[5.742px] rounded-[11.483px] border-0 px-[6px] py-[4px] text-[11px] font-medium leading-[8.613px] transition-[filter,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-60 hover:[&:not(:disabled)]:brightness-95"
        disabled={disconnectDisabled}
        onClick={() => {
          if (studioPlayground.phase !== 'ready') {
            return;
          }

          void (async () => {
            if (!(await canNavigateStudio())) return;
            await stopStudioActivityBeforeSessionDestroy();
            await studioPlayground.controller.actions.destroySession();
            onSelectOverview?.();
          })();
          // After tearing down the session, jump back to the Overview page so
          // the user lands on a meaningful screen instead of an empty device pane.
        }}
        style={{
          background: pillColors.bg,
          color: pillColors.fg,
          cursor: disconnectDisabled ? undefined : 'pointer',
        }}
        type="button"
      >
        <span
          aria-hidden="true"
          className="h-[5.742px] w-[5.742px] rounded-full"
          style={{
            background: pillColors.dot,
          }}
        />
        <span className="whitespace-nowrap">
          {pillStatusLabel[connectionStatus]}
        </span>
      </button>
      {!disconnectDisabled ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-full z-20 flex flex-col items-end pt-[4px] opacity-0 transition-opacity duration-150 group-hover/disconnect-pill:opacity-100"
        >
          <span
            className="mr-[14px] -mb-[1px] h-[6.7px] w-[10px]"
            style={{
              backgroundColor: '#090909',
              clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)',
            }}
          />
          <span
            className="whitespace-nowrap rounded-[4px] px-[12px] py-[8px] text-[12px] leading-[20px] font-medium text-white"
            style={{ backgroundColor: '#000000' }}
          >
            {t('Disconnect')}
          </span>
        </div>
      ) : null}
    </div>
  );

  useEffect(() => {
    if (!isConnected) {
      setPreviewStatus(null);
      setPreviewStatusText(null);
      setPreviewDeviceSize(null);
      setWebNavigationBusyAction(null);
      setWebIsLoading(false);
    }
  }, [isConnected]);

  // Drop the pending-platform override once antd's form watch (or
  // runtimeInfo) catches up — from then on `resolvedPreviewPlatform`
  // is the source of truth.
  useEffect(() => {
    if (
      resolvedPreviewPlatform &&
      pendingCreatePlatform &&
      resolvedPreviewPlatform === pendingCreatePlatform
    ) {
      setPendingCreatePlatform?.(undefined);
    }
  }, [
    resolvedPreviewPlatform,
    pendingCreatePlatform,
    setPendingCreatePlatform,
  ]);

  // Web navigation toolbar polls /interface-info for `isLoading` so the
  // reload/stop button reflects the current page state. Depend on the few
  // primitives we actually read instead of the whole `studioPlayground`
  // controller object — that object's identity changes on every render and
  // would tear down/rebuild the interval each frame.
  const webNavigationServerOnline =
    studioPlayground.phase === 'ready'
      ? studioPlayground.controller.state.serverOnline
      : false;
  const webNavigationSDK =
    studioPlayground.phase === 'ready'
      ? studioPlayground.controller.state.playgroundSDK
      : null;
  useEffect(() => {
    if (!showWebNavigation || !webNavigationServerOnline || !webNavigationSDK) {
      setWebIsLoading(false);
      return;
    }

    let cancelled = false;
    const refreshWebLoadingState = async () => {
      try {
        const info = await webNavigationSDK.getInterfaceInfo();
        if (cancelled) return;
        setWebIsLoading(Boolean(info?.navigationState?.isLoading));
        const siteIcon = (
          info?.navigationState as { siteIcon?: WebSiteIcon } | undefined
        )?.siteIcon;
        if (siteIcon) updateWebPageIcon(siteIcon);
      } catch (error) {
        if (!cancelled) {
          debugWebNavigation('failed to refresh web loading state: %s', error);
          setWebIsLoading(false);
        }
      }
    };

    void refreshWebLoadingState();
    const timer = window.setInterval(refreshWebLoadingState, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [showWebNavigation, webNavigationServerOnline, webNavigationSDK]);

  const runWebNavigationAction = async (
    actionType: 'GoBack' | 'GoForward' | 'Stop' | 'Reload',
  ) => {
    const sdk = webNavigationSDK;
    if (
      studioPlayground.phase !== 'ready' ||
      !sdk ||
      webNavigationBusyAction !== null ||
      previewPlatform !== 'web'
    ) {
      return;
    }
    setWebNavigationBusyAction(actionType);
    try {
      if (actionType !== 'Stop') {
        setWebIsLoading(true);
      }
      if (actionType === 'Reload') {
        await stopActiveTimelineExecution();
      }
      const result = await sdk.interact({
        actionType,
      });
      if (!result.ok) {
        debugWebNavigation(
          'failed to run web navigation action "%s": %s',
          actionType,
          result.error || t('Unknown error'),
        );
      } else {
        setWebIsLoading(false);
      }
    } finally {
      setWebNavigationBusyAction(null);
    }
  };

  const pauseDiscoveryPolling = shouldPauseDiscoveryPollingDuringPreview({
    previewStatus,
    runtimeInfo,
    sessionConnected: isConnected,
    sessionMutating:
      studioPlayground.phase === 'ready'
        ? studioPlayground.controller.state.sessionMutating
        : false,
  });

  useEffect(() => {
    studioPlayground.setDiscoveryPollingPaused(pauseDiscoveryPolling);
    return () => {
      studioPlayground.setDiscoveryPollingPaused(false);
    };
  }, [pauseDiscoveryPolling, studioPlayground]);

  // When the scrcpy preview reports an error (most common cause: the physical
  // device was unplugged after the sidebar rendered), refresh the session
  // setup so the now-stale device drops out of the sidebar and overview
  // buckets. `refreshSessionSetup` re-runs `adb devices`, so anything still
  // plugged in stays put.
  const refreshSessionSetup =
    studioPlayground.phase === 'ready'
      ? studioPlayground.controller.actions.refreshSessionSetup
      : null;
  const currentFormValuesRef = useRef<Record<string, unknown> | null>(null);
  currentFormValuesRef.current =
    studioPlayground.phase === 'ready'
      ? studioPlayground.controller.state.formValues
      : null;
  const previewStatusRef = useRef<StudioPreviewConnectionState>(null);
  useEffect(() => {
    const previous = previewStatusRef.current;
    previewStatusRef.current = previewStatus;
    if (previewStatus !== 'error' || previous === 'error') {
      return;
    }
    if (!refreshSessionSetup) {
      return;
    }
    void refreshSessionSetup(currentFormValuesRef.current ?? undefined);
  }, [previewStatus, refreshSessionSetup]);

  const openWebPage = async (input: SavedWebPage) => {
    if (!isReady || studioPlayground.controller.state.sessionMutating) return;
    if (!(await canNavigateStudio())) return;
    const { headed, url, viewportHeight, viewportWidth } = input;
    const { actions, state } = studioPlayground.controller;
    const selectionValues = {
      platformId: 'web' as const,
      'web.url': url,
      'web.viewportWidth': viewportWidth,
      'web.viewportHeight': viewportHeight,
      'web.headed': headed,
    };
    setPendingCreatePlatform?.('web');
    state.form.setFieldsValue(selectionValues);
    onSelectDeviceView?.();
    if (state.sessionViewState.connected) {
      await stopStudioActivityBeforeSessionDestroy();
      await actions.destroySession();
    }
    // Destroy refreshes setup defaults; keep the preview and recorder aligned
    // with the dimensions of the newly selected saved page.
    state.form.setFieldsValue(selectionValues);
    const created = await actions.createSession({
      ...state.form.getFieldsValue(true),
      ...selectionValues,
    });
    if (!created) return;
    saveWebPage(input);
    // The page is settled into waitForNetworkIdle by the time
    // createSession resolves, but the MJPEG <img> doesn't mount
    // until React commits the new "connected" state and the
    // browser opens the /mjpeg HTTP request. If we fire Reload
    // immediately, page.reload() generates frames *before* any
    // subscriber is attached — by the time the <img> connects,
    // the page is idle again and CDP screencast emits nothing
    // new, so the user sees a blank canvas. Wait long enough for
    // the React commit + browser MJPEG handshake to complete
    // (~1.5s in practice) before triggering the reload that
    // actually pushes a frame to the now-attached subscriber.
    window.setTimeout(() => {
      if (studioPlayground.phase !== 'ready') return;
      const sdk = studioPlayground.controller.state.playgroundSDK;
      void sdk.interact({ actionType: 'Reload' }).catch((error: unknown) => {
        debugWebNavigation('post-create web reload failed: %s', error);
      });
    }, 1500);
  };
  const openWebPageRef = useRef(openWebPage);
  openWebPageRef.current = openWebPage;
  const restoredWebPageRef = useRef(false);
  useEffect(() => {
    const open = (event: Event) => {
      restoredWebPageRef.current = true;
      void openWebPageRef
        .current((event as CustomEvent<SavedWebPage>).detail)
        .catch((error) =>
          debugWebNavigation('Unable to open saved page: %s', error),
        );
    };
    window.addEventListener('studio:open-saved-page', open);
    return () => window.removeEventListener('studio:open-saved-page', open);
  }, []);
  useEffect(() => {
    if (
      !isReady ||
      !studioPlayground.controller.state.serverOnline ||
      !studioPlayground.controller.state.sessionSetup ||
      studioPlayground.controller.state.sessionLoading ||
      isSessionMutating ||
      restoredWebPageRef.current
    )
      return;
    restoredWebPageRef.current = true;
    if (isConnected) return;
    const saved = loadSavedWebPages()[0];
    if (saved)
      void openWebPageRef
        .current(saved)
        .catch((error) =>
          debugWebNavigation('Unable to restore page: %s', error),
        );
  }, [isReady, studioPlayground, isSessionMutating, isConnected]);

  if (activeView === 'overview') {
    const overviewSessionBuckets = isReady
      ? buildStudioSidebarDeviceBuckets({
          formValues: studioPlayground.controller.state.formValues,
          runtimeInfo: studioPlayground.controller.state.runtimeInfo,
          targets:
            studioPlayground.controller.state.sessionSetup?.targets || [],
        })
      : { android: [], ios: [], computer: [], harmony: [], web: [] };
    const overviewBuckets = mergeSidebarDeviceBucketsWithDiscovery(
      overviewSessionBuckets,
      studioPlayground.discoveredDevices,
    );
    const overviewSelectedDeviceId =
      isReady && studioPlayground.controller.state.sessionMutating
        ? selectedDeviceId
        : undefined;

    return (
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] bg-surface">
        <div className="app-drag absolute left-0 right-0 top-0 z-0 h-[48px]" />
        <DeviceList
          buckets={overviewBuckets}
          connectingDeviceId={overviewSelectedDeviceId}
          errors={studioPlayground.discoveryErrors}
          modelConfigComplete={modelConfigComplete}
          modelEnvText={modelEnvText}
          onOpenEnvModal={onOpenEnvModal}
          sessionMutating={
            isReady ? studioPlayground.controller.state.sessionMutating : false
          }
          onCreateWebSession={openWebPage}
          onConnect={async (platform, device) => {
            if (!isReady) {
              return;
            }
            if (!(await canNavigateStudio())) return;
            const { actions, state } = studioPlayground.controller;
            const selectionValues = buildDeviceSelectionFormValues(
              platform,
              device,
            );
            setPendingCreatePlatform?.(platform);
            onSelectDeviceView?.();
            if (
              connectedDeviceId === device.id ||
              (device.selected && device.status === 'active')
            ) {
              return;
            }
            state.form.setFieldsValue(selectionValues);
            if (state.sessionViewState.connected) {
              await stopStudioActivityBeforeSessionDestroy();
              await actions.destroySession();
            }
            const sessionValues = {
              ...state.form.getFieldsValue(true),
              ...selectionValues,
            };
            await actions.createSession(sessionValues);
          }}
          onDisconnect={async () => {
            if (!isReady) {
              return;
            }
            if (!(await canNavigateStudio())) return;
            const { actions, state } = studioPlayground.controller;
            if (state.sessionViewState.connected) {
              await stopStudioActivityBeforeSessionDestroy();
              await actions.destroySession();
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] bg-surface">
      {/*
       * Device-preview top bar: icon + device name with ADB / Viewport meta
       * on the left, and a pill-shaped status/disconnect control on the
       * right that reveals a "Disconnect" tooltip on hover.
       */}
      <div
        className="app-drag relative flex h-[52px] items-center justify-between border-b border-border-subtle bg-surface pl-[8px] pr-4 dark:border-[#323131]"
        style={
          titlebarInsetLeft > 0 || titlebarInsetRight > 0
            ? {
                ...(titlebarInsetLeft > 0
                  ? { paddingLeft: titlebarInsetLeft }
                  : {}),
                ...(titlebarInsetRight > 0
                  ? { paddingRight: titlebarInsetRight }
                  : {}),
              }
            : undefined
        }
      >
        <div className="flex min-w-0 flex-1 items-center gap-[8px]">
          <div className="ml-[8px] flex h-[32px] w-[32px] shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-border-subtle bg-surface-muted">
            {previewPlatform === 'web' && webDisplay ? (
              <WebsiteIcon
                key={webDisplay.url}
                page={webDisplay}
                className="size-[26px] shrink-0"
              />
            ) : (
              <img
                alt=""
                aria-hidden="true"
                className="h-[26px] w-[26px] object-contain"
                src={resolvePlatformLogo(previewPlatform)}
              />
            )}
          </div>
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-[8px]">
              <span
                className="max-w-[220px] truncate text-[14px] leading-[22px] font-medium text-text-primary"
                title={deviceLabel}
              >
                {deviceLabel}
              </span>
              {liveStatusPill}
            </div>
            {previewHeaderSubInfo.length > 0 ? (
              <span className="flex items-center gap-[8px] text-[10px] leading-[12px] font-normal text-black/50 dark:text-white/50">
                {previewHeaderSubInfo.map((item, index) => (
                  <span
                    key={item.key}
                    className="flex items-center gap-[8px] min-w-0"
                  >
                    {index > 0 ? (
                      <span
                        aria-hidden="true"
                        className="h-[12px] w-px shrink-0 bg-[rgba(0,0,0,0.08)] dark:bg-white/[0.08]"
                      />
                    ) : null}
                    <span className="max-w-[220px] truncate" title={item.text}>
                      {item.text}
                    </span>
                  </span>
                ))}
              </span>
            ) : null}
          </div>
          {showWebNavigation ? (
            <div
              aria-label={t('Web navigation')}
              className="app-no-drag ml-[10px] flex h-[32px] items-center gap-[2px] rounded-[8px] bg-transparent px-[2px]"
            >
              <WebNavigationButton
                aria-label={t('Go back')}
                disabled={
                  webNavigationBusyAction !== null || scenarioExecutionBusy
                }
                onClick={() => {
                  void runWebNavigationAction('GoBack');
                }}
              >
                <BackIcon />
              </WebNavigationButton>
              <WebNavigationButton
                aria-label={t('Go forward')}
                disabled={
                  webNavigationBusyAction !== null || scenarioExecutionBusy
                }
                onClick={() => {
                  void runWebNavigationAction('GoForward');
                }}
              >
                <ForwardIcon />
              </WebNavigationButton>
              {webIsLoading ? (
                <WebNavigationButton
                  aria-label={t('Stop loading')}
                  disabled={
                    webNavigationBusyAction !== null || scenarioExecutionBusy
                  }
                  onClick={() => {
                    void runWebNavigationAction('Stop');
                  }}
                >
                  <StopIcon />
                </WebNavigationButton>
              ) : (
                <WebNavigationButton
                  aria-label={t('Reload page')}
                  disabled={
                    webNavigationBusyAction !== null || scenarioExecutionBusy
                  }
                  onClick={() => {
                    void runWebNavigationAction('Reload');
                  }}
                >
                  <RefreshIcon
                    spinning={webNavigationBusyAction === 'Reload'}
                  />
                </WebNavigationButton>
              )}
            </div>
          ) : null}
        </div>

        <div
          className="app-no-drag flex h-[28px] shrink-0 items-center pl-[8px]"
          style={{
            width: Math.max(
              200,
              STUDIO_MODE_PANEL_WIDTH - 10 - (titlebarInsetRight || 16),
            ),
          }}
        >
          <StudioWorkspaceSwitch
            busy={previewBoundaryActive}
            mode={workspaceMode}
            onModeChange={onWorkspaceModeChange}
          />
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-surface">
        <div
          className="box-border h-full min-w-0 overflow-hidden"
          style={
            floatingStudioModePanel
              ? undefined
              : { paddingRight: STUDIO_MODE_PANEL_WIDTH }
          }
        >
          <MobilePreviewFrame
            aspectRatio={previewAspectRatio}
            enabled={shouldFrameMobilePreview}
            highlightActive={previewBoundaryActive}
          >
            {studioPlayground.phase === 'booting' ? (
              <div className="flex h-full items-center justify-center px-6 text-[14px] text-text-tertiary">
                {t('Playground starting...')}
              </div>
            ) : studioPlayground.phase === 'error' ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
                <div className="max-w-[420px] text-[14px] leading-[22px] text-text-secondary">
                  {studioPlayground.error}
                </div>
                <button
                  className="cursor-pointer rounded-lg border border-border-subtle px-4 py-2 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-hover"
                  onClick={() => {
                    void studioPlayground.restartPlayground();
                  }}
                  type="button"
                >
                  {t('Retry runtime')}
                </button>
              </div>
            ) : !studioPlayground.controller.state.serverOnline &&
              activeStudioMode !== StudioModeTab.Replay ? (
              <div className="flex h-full items-center justify-center px-8 text-center text-[14px] leading-[22px] text-text-tertiary">
                {t('Playground server is offline.')}
              </div>
            ) : isPreviewConnecting ? (
              <ConnectingPreview
                iconSrc={resolvePlatformLogo(previewPlatform)}
                iconVariant={
                  previewPlatform === 'ios' ||
                  previewPlatform === 'android' ||
                  previewPlatform === 'harmony'
                    ? 'phone'
                    : 'desktop'
                }
                statusLabel={previewConnectingLabel}
              />
            ) : studioPlayground.controller.state.sessionViewState.connected ? (
              <div
                className={[
                  'box-border h-full w-full',
                  shouldPadDesktopPreview ? 'px-6' : '',
                  previewPlatform === 'web'
                    ? 'studio-web-preview-fixed-aspect'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  ...webPreviewCanvasStyle,
                  pointerEvents: scenarioExecutionBusy ? 'none' : undefined,
                }}
                {...(scenarioExecutionBusy ? { inert: '' } : {})}
              >
                <PlaygroundPreview
                  connectingOverlay={
                    <ConnectingPreview
                      iconSrc={resolvePlatformLogo(previewPlatform)}
                      iconVariant={
                        previewPlatform === 'ios' ||
                        previewPlatform === 'android' ||
                        previewPlatform === 'harmony'
                          ? 'phone'
                          : 'desktop'
                      }
                      statusLabel={previewStatusText || previewConnectingLabel}
                    />
                  }
                  onDeviceSizeChange={setPreviewDeviceSize}
                  onScrcpyStatusChange={(status, statusText) => {
                    setPreviewStatus(status);
                    setPreviewStatusText(statusText);
                  }}
                  renderErrorOverlay={({ retry }) => (
                    <ConnectionFailedPreview
                      pageUrl={webDisplay?.url}
                      iconSrc={assetUrls.main.platformWeb}
                      onReconnect={retry}
                    />
                  )}
                  playgroundSDK={
                    studioPlayground.controller.state.playgroundSDK
                  }
                  screenshotViewerMode="screen-only"
                  scrcpyViewportStyle={{
                    ...(shouldFrameMobilePreview
                      ? { background: 'transparent' }
                      : {}),
                    borderRadius: 12,
                  }}
                  runtimeInfo={studioPlayground.controller.state.runtimeInfo}
                  serverOnline={studioPlayground.controller.state.serverOnline}
                  serverUrl={studioPlayground.serverUrl}
                  isUserOperating={
                    studioPlayground.controller.state.isUserOperating
                  }
                />
              </div>
            ) : (
              <DisconnectedPreview
                iconSrc={assetUrls.main.platformWeb}
                title={disconnectedPreviewTitle}
              />
            )}
          </MobilePreviewFrame>
        </div>
        <div
          className={[
            'absolute bottom-0 right-0 top-0 z-10 box-border flex min-h-0 flex-col overflow-hidden rounded-br-[12px] p-[10px]',
            floatingStudioModePanel
              ? 'pointer-events-none studio-mode-panel-overlay-floating'
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ width: STUDIO_MODE_PANEL_WIDTH }}
        >
          <StudioWorkspace
            actions={studioModeHeaderActions}
            menu={workbenchMenu}
            mode={workspaceMode}
            onMenuChange={onWorkbenchMenuChange}
            onOriginalModeChange={handleStudioModeChange}
            originalMode={activeStudioMode}
          >
            <StudioModePanel
              onHeaderChange={syncStudioModeHeaderActions}
              onCloseStudioRightPanel={onCloseStudioRightPanel}
              onOpenStudioRightPanel={onOpenStudioRightPanel}
              onStudioModeChange={handleStudioModeChange}
              onTimelineExecutionStatusChange={setTimelineExecutionStatus}
              studioMode={activeStudioMode}
            />
          </StudioWorkspace>
        </div>
      </div>
    </div>
  );
}
