import { Segmented, Tabs } from 'antd';
import type { ReactNode } from 'react';
import { t, useStudioLanguage } from '../../i18n';
import { type StudioMode, StudioModeTab } from '../../recorder/types';
import { StudioScenarios } from '../StudioScenarios';
import { StudioExecutionRecords } from '../StudioScenarios/StudioExecutionRecords';
import type { StudioWorkbenchMenu, StudioWorkspaceMode } from './preferences';
import './studio-workspace.css';

export function StudioWorkspaceSwitch({
  busy,
  mode,
  onModeChange,
}: {
  busy: boolean;
  mode: StudioWorkspaceMode;
  onModeChange?: (mode: StudioWorkspaceMode) => void;
}) {
  useStudioLanguage();
  return (
    <Segmented
      aria-label={t('Workspace mode')}
      block
      className="app-no-drag studio-workspace-switch"
      disabled={busy}
      onChange={(value) => {
        if (!busy && (value === 'original' || value === 'workbench')) {
          onModeChange?.(value);
        }
      }}
      options={[
        {
          label: <span title={t('Original mode')}>{t('Original mode')}</span>,
          value: 'original',
        },
        {
          label: <span title={t('Scenario mode')}>{t('Scenario mode')}</span>,
          value: 'workbench',
        },
      ]}
      size="small"
      value={mode}
    />
  );
}

export function StudioWorkspace({
  actions,
  children,
  menu,
  mode,
  onMenuChange,
  onOriginalModeChange,
  originalMode,
}: {
  actions?: ReactNode;
  children: ReactNode;
  menu: StudioWorkbenchMenu;
  mode: StudioWorkspaceMode;
  onMenuChange?: (menu: StudioWorkbenchMenu) => void;
  onOriginalModeChange?: (mode: StudioMode) => void;
  originalMode: StudioMode;
}) {
  useStudioLanguage();
  const original = mode === 'original';

  return (
    <div className="studio-workspace">
      <Tabs
        activeKey={original ? originalMode : menu}
        className="app-no-drag studio-workspace-menus"
        items={
          original
            ? [
                { key: StudioModeTab.Record, label: t('Record') },
                { key: StudioModeTab.Replay, label: t('Replay') },
                {
                  key: StudioModeTab.Playground,
                  label: (
                    <span title={t('API Playground')}>
                      {t('API debugging')}
                    </span>
                  ),
                },
              ]
            : [
                { key: 'scenarios', label: t('Scenarios') },
                { key: 'execution-records', label: t('Execution records') },
              ]
        }
        onChange={(value) => {
          if (original) {
            if (
              value === StudioModeTab.Record ||
              value === StudioModeTab.Replay ||
              value === StudioModeTab.Playground
            ) {
              onOriginalModeChange?.(value);
            }
          } else if (value === 'scenarios' || value === 'execution-records') {
            onMenuChange?.(value);
          }
        }}
        size="small"
        tabBarExtraContent={original ? actions : undefined}
        tabBarGutter={16}
      />
      <div
        aria-hidden={!original}
        className="studio-workspace-original"
        style={original ? undefined : { display: 'none' }}
      >
        {children}
      </div>
      <StudioScenarios active={!original && menu === 'scenarios'} />
      {!original && menu === 'execution-records' ? (
        <StudioExecutionRecords />
      ) : null}
    </div>
  );
}
