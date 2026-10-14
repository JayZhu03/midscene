import { type ReactNode, useEffect, useState } from 'react';
import { STUDIO_EXTERNAL_LINKS } from '../../../shared/external-links';
import { assetUrls } from '../../assets';
import { t, useStudioLanguage } from '../../i18n';
import {
  savedWebPageDisplay,
  useSavedWebPages,
} from '../../playground/saved-web-pages';
import type {
  DiscoveryErrorsByPlatform,
  StudioAndroidDeviceItem,
  StudioSidebarDeviceBuckets,
  StudioSidebarPlatformKey,
} from '../../playground/types';
import { saveStudioPreference } from '../../studio-preferences-backup';
import { WebSiteIcon } from '../WebSiteIcon';
import { WebCreateAgentCard, type WebCreateInput } from './CreateAgentCard';
import { ModelConfigCard } from './ModelConfigCard';

type DeviceConnectionState = 'idle' | 'live' | 'connecting';

interface PlatformConfig {
  iconSrc?: string;
  key: StudioSidebarPlatformKey;
  label: string;
  /** Subtext label shown before the device id, e.g. "ADB Device". */
  idLabel?: string;
}

// Per-platform glyphs mirror the connected-device chip at the top of the
// shell, so the overview cards stay visually aligned with the preview
// header.
const PLATFORM_CONFIGS: PlatformConfig[] = [
  {
    iconSrc: assetUrls.main.platformAndroid,
    key: 'android',
    label: 'Android',
    idLabel: 'ADB',
  },
  {
    iconSrc: assetUrls.main.platformWeb,
    key: 'web',
    label: 'Web',
  },
];

function LinkIcon() {
  useStudioLanguage();

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <path
        d="M6.7 9.3l2.6-2.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
      <path
        d="M7.2 4.4l1.1-1.1a2.8 2.8 0 0 1 4 4l-1.1 1.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
      <path
        d="M8.8 11.6l-1.1 1.1a2.8 2.8 0 0 1-4-4l1.1-1.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function SpinnerIcon() {
  useStudioLanguage();

  return (
    <svg
      aria-hidden="true"
      className="animate-spin"
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <circle
        cx="8"
        cy="8"
        opacity="0.25"
        r="6"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function LiveBadge() {
  useStudioLanguage();

  return (
    <span className="inline-flex h-[17px] shrink-0 items-center gap-[6px] rounded-[12px] bg-status-success-bg px-[6px]">
      <span className="h-[6px] w-[6px] rounded-full bg-status-success shadow-[0_0_0_1.4px_rgba(66,181,108,0.25)]" />
      <span className="font-sans text-[11px] font-medium leading-[12px] text-status-success-fg">
        {t('Live')}
      </span>
    </span>
  );
}

function ConnectingBadge() {
  useStudioLanguage();

  return (
    <span className="inline-flex h-[17px] shrink-0 items-center gap-[6px] rounded-[12px] bg-status-info-bg px-[6px]">
      <span className="h-[6px] w-[6px] rounded-full bg-status-info" />
      <span className="font-sans text-[11px] font-medium leading-[12px] text-status-info">
        {t('Connecting')}
      </span>
    </span>
  );
}

export interface DeviceListProps {
  initialPlatform?: 'web' | 'android';
  buckets: StudioSidebarDeviceBuckets;
  connectingDeviceId?: string;
  errors?: DiscoveryErrorsByPlatform;
  onConnect?: (
    platform: StudioSidebarPlatformKey,
    device: StudioAndroidDeviceItem,
  ) => void | Promise<void>;
  onDisconnect?: (
    platform: StudioSidebarPlatformKey,
    device: StudioAndroidDeviceItem,
  ) => void | Promise<void>;
  /** Whether MIDSCENE_MODEL_* env values are complete enough to run. */
  modelConfigComplete?: boolean;
  /** Raw env text — previewed in the expanded Model Config card. */
  modelEnvText?: string;
  /** Opens the env config modal anchored in the shell. */
  onOpenEnvModal?: () => void;
  /**
   * Submits a Web playground session (URL / viewport / browser mode).
   * Rendered as an inline form at the top of the Web section.
   */
  onCreateWebSession?: (input: WebCreateInput) => void | Promise<void>;
  /** Disables form submission while a session is being mutated. */
  sessionMutating?: boolean;
  onRefresh?: () => Promise<void>;
}

const PLATFORM_TOOLCHAIN_HINTS: Partial<
  Record<StudioSidebarPlatformKey, { label: string; href: string }>
> = {
  android: {
    label: '⚠️ ADB not detected',
    href: STUDIO_EXTERNAL_LINKS.androidIntegrationFaq,
  },
  harmony: {
    label: '⚠️ HDC not detected',
    href: STUDIO_EXTERNAL_LINKS.harmonyGettingStarted,
  },
};

function ToolchainMissingTile({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  useStudioLanguage();

  return (
    <button
      className="flex h-[66px] w-full cursor-pointer items-center justify-center rounded-[8px] border border-dashed border-border-subtle bg-transparent px-[16px] font-sans text-[12px] text-text-secondary underline-offset-2 transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-text-primary hover:underline"
      onClick={() => {
        void window.electronShell?.openExternalUrl(href);
      }}
      type="button"
    >
      {label}
    </button>
  );
}

function DeviceCardBody({
  device,
  site,
  iconSrc,
  idLabel,
  status,
  trailingSlot,
}: {
  device: StudioAndroidDeviceItem;
  site?: ReturnType<typeof savedWebPageDisplay>;
  iconSrc?: string;
  idLabel?: string;
  status: DeviceConnectionState;
  trailingSlot: ReactNode;
}) {
  useStudioLanguage();

  const idText = device.description;
  const showIdLine = Boolean(idText && idText !== device.label);

  return (
    <>
      <div className="flex h-[40px] w-[40px] shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-border-subtle bg-surface-muted">
        {site ? (
          <WebSiteIcon key={site.url} page={site} className="size-7 shrink-0" />
        ) : iconSrc ? (
          <img
            alt=""
            className="h-[29px] w-[29px] object-contain"
            src={iconSrc}
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[2px]">
        <div className="flex items-center gap-[8px]">
          <span className="overflow-hidden truncate font-sans text-[14px] font-medium leading-[22px] text-text-primary">
            {device.label}
          </span>
          {status === 'live' ? <LiveBadge /> : null}
          {status === 'connecting' ? <ConnectingBadge /> : null}
        </div>
        {showIdLine ? (
          <span
            title={idText}
            className="flex items-center gap-[8px] font-sans text-[12px] leading-[18px] text-text-secondary"
          >
            <span className="overflow-hidden truncate">
              {idLabel ? `${idLabel}：${idText}` : idText}
            </span>
          </span>
        ) : null}
      </div>

      {trailingSlot}
    </>
  );
}

function DeviceCard({
  device,
  site,
  iconSrc,
  idLabel,
  status,
  onConnect,
  onDisconnect,
}: {
  device: StudioAndroidDeviceItem;
  site?: ReturnType<typeof savedWebPageDisplay>;
  iconSrc?: string;
  idLabel?: string;
  status: DeviceConnectionState;
  onConnect?: () => void | Promise<void>;
  onDisconnect?: () => void | Promise<void>;
}) {
  useStudioLanguage();

  const isConnecting = status === 'connecting';
  const isLive = status === 'live';
  // Live cards stay clickable so the user can jump back into the device
  // view without disconnecting first — the onConnect handler in
  // MainContent already short-circuits the createSession step when the
  // clicked device is the currently-connected one, and only swaps the
  // active view to 'device'.
  const interactionClassName = isConnecting
    ? 'cursor-not-allowed opacity-70'
    : 'cursor-pointer hover:bg-surface-hover';
  const cardClassName =
    `box-border flex h-[66px] w-full shrink-0 items-center gap-[12px] rounded-[8px] bg-transparent px-[12px] py-[12px] text-left outline-none focus-visible:bg-surface-hover ${interactionClassName}`.trim();

  const handleCardClick = () => {
    if (isConnecting) return;
    void onConnect?.();
  };
  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isConnecting) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void onConnect?.();
    }
  };

  return (
    <div
      aria-disabled={isConnecting ? true : undefined}
      className={cardClassName}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      // biome-ignore lint/a11y/useSemanticElements: the card embeds its own Disconnect <button>; nesting button-in-button would be invalid HTML.
      role="button"
      tabIndex={isConnecting ? -1 : 0}
    >
      <DeviceCardBody
        device={device}
        site={site}
        iconSrc={iconSrc}
        idLabel={idLabel}
        status={status}
        trailingSlot={
          isLive ? (
            <button
              aria-label={t('Disconnect')}
              className="flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-status-success-fg transition-colors hover:bg-status-error-bg hover:text-status-error"
              onClick={(event) => {
                event.stopPropagation();
                void onDisconnect?.();
              }}
              title={t('Disconnect')}
              type="button"
            >
              <LinkIcon />
            </button>
          ) : (
            <div
              className={`flex h-[28px] w-[28px] shrink-0 items-center justify-center ${
                isConnecting ? 'text-status-info' : 'text-text-tertiary'
              }`}
            >
              {isConnecting ? <SpinnerIcon /> : <LinkIcon />}
            </div>
          )
        }
      />
    </div>
  );
}

export function DeviceList({
  initialPlatform = 'web',
  buckets,
  connectingDeviceId,
  errors,
  modelConfigComplete,
  onConnect,
  onCreateWebSession,
  onDisconnect,
  onOpenEnvModal,
  sessionMutating,
  onRefresh,
}: DeviceListProps) {
  useStudioLanguage();
  const savedPages = useSavedWebPages();
  const [platform, setPlatform] = useState<'web' | 'android'>(initialPlatform);
  useEffect(() => setPlatform(initialPlatform), [initialPlatform]);
  const [appPackage, setAppPackage] = useState(
    () => localStorage.getItem('studio.android-app') || '',
  );
  const [connectionError, setConnectionError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const connect = async (
    key: StudioSidebarPlatformKey,
    device: StudioAndroidDeviceItem,
  ) => {
    setConnectionError('');
    setConnecting(true);
    try {
      saveStudioPreference('studio.android-app', appPackage.trim());
      await onConnect?.(
        key,
        key === 'android'
          ? {
              ...device,
              sessionValues: {
                ...device.sessionValues,
                deviceId: device.id,
                appPackage: appPackage.trim(),
              },
            }
          : device,
      );
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setConnecting(false);
    }
  };

  const sections = PLATFORM_CONFIGS.filter(
    (config) => config.key === platform,
  ).map((config) => ({
    ...config,
    devices: buckets[config.key].map((device) => {
      if (config.key !== 'web') return device;
      const display = savedWebPageDisplay(
        device.sessionValues?.url ?? device.label,
        savedPages,
      );
      return {
        ...device,
        label: display?.name ?? device.label,
        description: display?.url,
      };
    }),
    toolchainHint:
      errors?.[config.key]?.kind === 'toolchain-missing'
        ? PLATFORM_TOOLCHAIN_HINTS[config.key]
        : undefined,
  }));

  const showModelConfigCard = typeof modelConfigComplete === 'boolean';

  const renderSectionCreateForm = (key: StudioSidebarPlatformKey) => {
    if (key === 'web' && onCreateWebSession) {
      return (
        <WebCreateAgentCard
          busy={sessionMutating || connecting}
          onSubmit={onCreateWebSession}
        />
      );
    }
    return null;
  };

  return (
    <div className="flex h-full w-full flex-col items-center overflow-y-auto px-[16px] pb-[40px] pt-[88px]">
      <div className="mb-6 flex w-full max-w-[704px] flex-wrap items-center justify-between gap-3">
        <h1
          className="m-0 text-[24px] font-medium not-italic leading-[32px] tracking-[0] text-[#0D0D0D] dark:text-text-primary"
          style={{ fontFamily: 'Inter, sans-serif' }}
        >
          {t('Workbench')}
        </h1>
        {showModelConfigCard ? (
          <ModelConfigCard
            complete={Boolean(modelConfigComplete)}
            onOpen={onOpenEnvModal}
          />
        ) : null}
      </div>
      <div className="flex w-full max-w-[704px] flex-col gap-6">
        <div className="flex gap-1 rounded-[10px] bg-surface-muted p-1">
          {(['web', 'android'] as const).map((key) => (
            <button
              type="button"
              key={key}
              disabled={sessionMutating || connecting}
              className={`h-9 flex-1 rounded-lg border-0 text-[13px] text-text-primary ${platform === key ? 'bg-surface shadow-sm' : 'bg-transparent hover:bg-surface-hover'}`}
              onClick={() => setPlatform(key)}
            >
              {t(key === 'web' ? 'Web' : 'Android')}
            </button>
          ))}
        </div>
        {platform === 'android' ? (
          <div className="flex flex-col gap-3 rounded-[12px] bg-surface-muted p-4">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-medium text-text-primary">
                {t('Connect Android Device')}
              </span>
              <button
                type="button"
                disabled={sessionMutating || connecting}
                className="rounded-md border-0 bg-transparent px-2 py-1 text-[13px] text-text-secondary hover:bg-surface-hover"
                onClick={() => {
                  void onRefresh?.().catch((error) =>
                    setConnectionError(String(error)),
                  );
                }}
              >
                {t('Refresh devices')}
              </button>
            </div>
            <label className="flex flex-col gap-2 text-[13px] text-text-secondary">
              {t('Target application (optional)')}
              <input
                className="box-border h-9 w-full rounded-lg border border-border-subtle bg-surface px-3 text-text-primary outline-none focus:border-brand"
                value={appPackage}
                disabled={sessionMutating || connecting}
                placeholder="com.example.app"
                onChange={(event) => setAppPackage(event.target.value)}
              />
            </label>
            <span className="text-[12px] text-text-tertiary">
              {t(
                'Enable USB debugging and authorize this computer, or connect through wireless ADB.',
              )}
            </span>
          </div>
        ) : null}
        {connectionError ? (
          <div role="alert" className="text-[13px] text-status-error">
            {connectionError}
          </div>
        ) : null}
        {sections.map((section) => {
          const createForm = renderSectionCreateForm(section.key);
          const hasDevices = section.devices.length > 0;
          return (
            <div className="flex w-full flex-col" key={section.key}>
              <div className="flex flex-col gap-3">
                {createForm}
                {hasDevices ? (
                  section.devices.map((device) => {
                    const status: DeviceConnectionState =
                      device.status === 'active'
                        ? 'live'
                        : connectingDeviceId === device.id
                          ? 'connecting'
                          : 'idle';
                    return (
                      <DeviceCard
                        device={device}
                        site={
                          section.key === 'web'
                            ? savedWebPageDisplay(
                                device.description,
                                savedPages,
                              )
                            : undefined
                        }
                        iconSrc={section.iconSrc}
                        idLabel={section.idLabel}
                        key={device.id}
                        onConnect={() => connect(section.key, device)}
                        onDisconnect={() =>
                          onDisconnect
                            ? onDisconnect(section.key, device)
                            : undefined
                        }
                        status={status}
                      />
                    );
                  })
                ) : createForm ? null : section.toolchainHint ? (
                  <ToolchainMissingTile
                    href={section.toolchainHint.href}
                    label={section.toolchainHint.label}
                  />
                ) : (
                  <div className="flex h-[66px] w-full items-center justify-center font-sans text-[12px] text-text-tertiary">
                    {t('No device. Please plug in the device and check.')}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
