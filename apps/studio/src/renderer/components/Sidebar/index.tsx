import { Dropdown, Modal } from 'antd';
import { useState } from 'react';
import { assetUrls } from '../../assets';
import { t, useStudioLanguage } from '../../i18n';
import {
  type SavedWebPage,
  removeWebPage,
  renameWebPage,
  useSavedWebPages,
} from '../../playground/saved-web-pages';
import {
  buildStudioSidebarDeviceBuckets,
  mergeSidebarDeviceBucketsWithDiscovery,
} from '../../playground/selectors';
import type { StudioSidebarPlatformKey } from '../../playground/types';
import { useStudioPlayground } from '../../playground/useStudioPlayground';
import { MaskedIcon } from '../MaskedIcon';
import SettingsDock from '../SettingsDock';
import type { ShellActiveView } from '../ShellLayout/types';
import { WebSiteIcon } from '../WebSiteIcon';

export interface SidebarProps {
  activeView: ShellActiveView;
  onSelectOverview: () => void;
  onSelectDevice: () => void;
  onPendingCreatePlatform?: (platform: StudioSidebarPlatformKey) => void;
}

export default function Sidebar({
  activeView,
  onSelectOverview,
  onSelectDevice,
  onPendingCreatePlatform,
}: SidebarProps) {
  useStudioLanguage();
  const pages = useSavedWebPages();
  const [editing, setEditing] = useState<SavedWebPage | null>(null);
  const [deleting, setDeleting] = useState<SavedWebPage | null>(null);
  const [name, setName] = useState('');
  const confirmRename = () => {
    if (!editing || !name.trim()) return;
    renameWebPage(editing.url, name);
    setEditing(null);
  };
  const playground = useStudioPlayground();
  const state =
    playground.phase === 'ready' ? playground.controller.state : null;
  const connectedUrl = state?.runtimeInfo?.metadata?.url;
  const androidDevices = mergeSidebarDeviceBucketsWithDiscovery(
    buildStudioSidebarDeviceBuckets({
      formValues: state?.formValues || {},
      runtimeInfo: state?.runtimeInfo || null,
      targets: state?.sessionSetup?.targets || [],
    }),
    playground.discoveredDevices,
  ).android;
  const rowClass =
    'flex h-9 w-full items-center gap-2 rounded-lg border-0 px-3 text-left text-[13px] text-text-secondary hover:bg-surface-hover disabled:opacity-50';
  return (
    <nav className="flex flex-col gap-2" aria-label={t('Workbench')}>
      <button
        type="button"
        className={`${rowClass} ${activeView === 'overview' ? 'bg-surface-hover' : 'bg-transparent'}`}
        onClick={onSelectOverview}
      >
        <MaskedIcon className="size-4 shrink-0" src={assetUrls.sidebar.web} />
        <span>{t('Workbench')}</span>
      </button>
      <div className="px-3 pt-3 text-[12px] text-text-tertiary">
        {t('Saved pages')}
      </div>
      {pages.length === 0 ? (
        <span className="px-3 text-[12px] text-text-tertiary">
          {t('No saved pages')}
        </span>
      ) : null}
      {pages.map((page) => {
        const active =
          activeView === 'device' &&
          connectedUrl === page.url &&
          state?.sessionViewState.connected;
        return (
          <div
            key={page.url}
            className={`group flex items-center rounded-lg ${active ? 'bg-surface-hover' : 'hover:bg-surface-hover'}`}
          >
            <button
              type="button"
              title={page.url}
              className={`${rowClass} min-w-0 flex-1 bg-transparent`}
              disabled={!state || state.sessionMutating}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (active) {
                  onSelectDevice();
                  return;
                }
                window.dispatchEvent(
                  new CustomEvent('studio:open-saved-page', { detail: page }),
                );
              }}
            >
              <WebSiteIcon page={page} />
              <span className="truncate">
                {page.name || new URL(page.url).host}
              </span>
            </button>
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{
                items: [
                  { key: 'rename', label: t('Rename page') },
                  { key: 'delete', label: t('Delete page'), danger: true },
                ],
                onClick: ({ key }) => {
                  if (key === 'rename') {
                    setName(page.name || new URL(page.url).host);
                    setEditing(page);
                  } else {
                    setDeleting(page);
                  }
                },
              }}
            >
              <button
                type="button"
                aria-label={`${t('Page actions')}: ${page.name || new URL(page.url).host}`}
                title={t('Page actions')}
                className="app-no-drag mr-1 flex size-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-text-secondary hover:bg-surface-hover-strong focus-visible:outline focus-visible:outline-2"
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <circle cx="3" cy="8" r="1.5" />
                  <circle cx="8" cy="8" r="1.5" />
                  <circle cx="13" cy="8" r="1.5" />
                </svg>
              </button>
            </Dropdown>
          </div>
        );
      })}
      <div className="px-3 pt-3 text-[12px] text-text-tertiary">
        {t('Android devices')}
      </div>
      {androidDevices.length === 0 ? (
        <button
          type="button"
          className={`${rowClass} bg-transparent`}
          onClick={() => {
            onPendingCreatePlatform?.('android');
            onSelectOverview();
          }}
        >
          {t('Connect Android Device')}
        </button>
      ) : (
        androidDevices.map((device) => (
          <button
            type="button"
            key={device.id}
            disabled={!state || state.sessionMutating}
            className={`${rowClass} ${activeView === 'device' && device.status === 'active' ? 'bg-surface-hover' : 'bg-transparent'}`}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent('studio:open-android-device', {
                  detail: {
                    ...device,
                    sessionValues: {
                      ...device.sessionValues,
                      deviceId: device.id,
                      appPackage:
                        state?.runtimeInfo?.platformId === 'android' &&
                        device.status === 'active'
                          ? state.runtimeInfo.metadata?.appPackage
                          : localStorage.getItem('studio.android-app') || '',
                    },
                  },
                }),
              )
            }
          >
            <img
              alt=""
              src={assetUrls.main.platformAndroid}
              className="size-4 shrink-0 object-contain"
            />
            <span className="truncate">{device.label}</span>
          </button>
        ))
      )}
      <Modal
        title={t('Rename page')}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={confirmRename}
        okText={t('Save')}
        cancelText={t('Cancel')}
        okButtonProps={{ disabled: !name.trim() }}
        afterOpenChange={(open) => {
          if (open) document.getElementById('saved-page-name')?.focus();
        }}
        width={360}
      >
        <input
          id="saved-page-name"
          aria-label={t('Page name')}
          className="box-border h-9 w-full rounded-lg border border-border-subtle bg-surface px-3 text-text-primary outline-none focus:border-blue-500"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => event.target.select()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing)
              confirmRename();
          }}
        />
      </Modal>
      <Modal
        title={t('Delete page')}
        open={!!deleting}
        onCancel={() => setDeleting(null)}
        onOk={() => {
          if (deleting) removeWebPage(deleting.url);
          setDeleting(null);
        }}
        okText={t('Delete')}
        cancelText={t('Cancel')}
        okButtonProps={{ danger: true }}
        width={360}
      >
        <p className="break-words font-medium">
          {deleting?.name || deleting?.url}
        </p>
        <p>
          {t(
            'Remove this page from the list? Browser login data will be kept.',
          )}
        </p>
      </Modal>
    </nav>
  );
}

export interface SidebarFooterProps {
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onEnvClick?: () => void;
  /** Surface a "missing config" red badge on the env dock row. */
  envAlert?: boolean;
}

export function SidebarFooter({
  envAlert,
  settingsOpen,
  onToggleSettings,
  onEnvClick,
}: SidebarFooterProps) {
  useStudioLanguage();

  return (
    <SettingsDock
      envAlert={envAlert}
      onEnvClick={onEnvClick}
      onToggleSettings={onToggleSettings}
      settingsOpen={settingsOpen}
    />
  );
}
