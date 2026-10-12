import type { ScenarioRunState } from '@midscene/playground';
import { Button, Dropdown } from 'antd';
import { useRef, useState } from 'react';
import { t } from '../../i18n';
import {
  EditIcon,
  ReplayIcon,
  TrashIcon,
} from '../Recorder/assets/recorder-icons';
import type { ScenarioScript } from './script-model';
import { type SequenceEntry, moveScript } from './sequence';

export const runStatusLabel = (status: string) =>
  t(
    (
      {
        pending: 'Not started',
        running: 'Running',
        waiting: 'Waiting for next',
        passed: 'Passed',
        failed: 'Failed',
        stopped: 'Stopped',
        stopping: 'Stopping',
        completed: 'Completed',
      } as Record<string, string>
    )[status] || status,
  );

export function StudioScriptSequence({
  scripts,
  sequence,
  locked,
  run,
  onChange,
  onOpen,
  onAction,
  canRun,
}: {
  scripts: ScenarioScript[];
  sequence: SequenceEntry[];
  locked: boolean;
  run: ScenarioRunState | null;
  onChange: (value: SequenceEntry[]) => void;
  onOpen: (script: ScenarioScript) => void;
  onAction: (
    action: 'rename' | 'delete' | 'run',
    script: ScenarioScript,
  ) => void;
  canRun: boolean;
}) {
  const suppressDragClick = useRef(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const byId = new Map(scripts.map((script) => [script.id, script]));
  return (
    <ol
      className="studio-scenario-list studio-script-sequence"
      aria-label={t('Script sequence')}
    >
      {sequence.map((entry, index) => {
        const script = byId.get(entry.id);
        if (!script) return null;
        const result = run?.scripts.find((item) => item.id === script.id);
        const mode =
          index === 0
            ? 'Start with scenario'
            : entry.startMode === 'manual'
              ? 'Manual continuation'
              : 'Automatic continuation';
        return (
          <li
            key={entry.id}
            className={`studio-sequence-row${over === entry.id && dragged !== entry.id ? ' studio-sequence-drop' : ''}`}
            data-status={result?.status}
            draggable={!locked}
            onPointerDownCapture={() => {
              suppressDragClick.current = false;
            }}
            onClickCapture={(event) => {
              if (suppressDragClick.current && event.detail !== 0) {
                event.preventDefault();
                event.stopPropagation();
                suppressDragClick.current = false;
              }
            }}
            onDragStart={(event) => {
              if (locked) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.setData('text/plain', entry.id);
              event.dataTransfer.effectAllowed = 'move';
              suppressDragClick.current = true;
              setDragged(entry.id);
            }}
            onDragEnd={() => {
              setDragged(null);
              setOver(null);
            }}
            onDragOver={(event) => {
              if (!locked && dragged) {
                event.preventDefault();
                setOver(entry.id);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (!locked && dragged)
                onChange(moveScript(sequence, dragged, entry.id));
              setDragged(null);
              setOver(null);
            }}
          >
            <span className="studio-sequence-node">{index + 1}</span>
            <div className="studio-sequence-content">
              <div className="studio-sequence-main">
                <button
                  type="button"
                  className="studio-sequence-name"
                  title={script.name}
                  aria-keyshortcuts={locked ? undefined : 'ArrowUp ArrowDown'}
                  onKeyDown={(event) => {
                    if (locked || !['ArrowUp', 'ArrowDown'].includes(event.key))
                      return;
                    event.preventDefault();
                    const target =
                      sequence[index + (event.key === 'ArrowUp' ? -1 : 1)];
                    if (target)
                      onChange(moveScript(sequence, entry.id, target.id));
                  }}
                  onClick={() => onOpen(script)}
                >
                  {script.name}
                </button>
                {result ? (
                  <span className="studio-sequence-status">
                    {runStatusLabel(result.status)}
                  </span>
                ) : (
                  <span className="studio-script-count">
                    {script.steps.length}
                  </span>
                )}
                <Dropdown
                  trigger={['click']}
                  placement="bottomRight"
                  disabled={locked}
                  overlayClassName="studio-scenario-menu"
                  menu={{
                    items: [
                      { key: 'rename', label: t('Rename'), icon: <EditIcon /> },
                      {
                        key: 'delete',
                        label: t('Delete'),
                        icon: <TrashIcon />,
                        danger: true,
                      },
                      { type: 'divider' },
                      {
                        key: 'run',
                        label: t('Run this script'),
                        icon: <ReplayIcon />,
                        disabled: !canRun,
                      },
                    ],
                    onClick: ({ key }) => {
                      if (
                        !locked &&
                        (key === 'rename' || key === 'delete' || key === 'run')
                      )
                        onAction(key, script);
                    },
                  }}
                >
                  <Button
                    type="text"
                    className="studio-scenario-actions"
                    disabled={locked}
                    aria-label={t('Script actions')}
                    title={t('Script actions')}
                  >
                    •••
                  </Button>
                </Dropdown>
              </div>
              <div className="studio-sequence-options">
                <Dropdown
                  trigger={['click']}
                  disabled={locked}
                  menu={{
                    selectedKeys: [index === 0 ? '' : entry.startMode],
                    items: [
                      {
                        key: 'automatic',
                        label: t('Automatic continuation'),
                        disabled: index === 0,
                      },
                      {
                        key: 'manual',
                        label: t('Manual continuation'),
                        disabled: index === 0,
                      },
                      { type: 'divider' },
                      { key: 'up', label: t('Move up'), disabled: index === 0 },
                      {
                        key: 'down',
                        label: t('Move down'),
                        disabled: index === sequence.length - 1,
                      },
                    ],
                    onClick: ({ key }) => {
                      if (locked) return;
                      if (key === 'up' || key === 'down') {
                        const target =
                          sequence[index + (key === 'up' ? -1 : 1)];
                        if (target)
                          onChange(moveScript(sequence, entry.id, target.id));
                      } else if (key === 'automatic' || key === 'manual')
                        onChange(
                          sequence.map((item) =>
                            item.id === entry.id
                              ? { ...item, startMode: key }
                              : item,
                          ),
                        );
                    },
                  }}
                >
                  <Button
                    type="text"
                    size="small"
                    disabled={locked}
                    aria-label={`${script.name}: ${t(mode)}`}
                  >
                    {t(mode)}
                    <span aria-hidden="true">⌄</span>
                  </Button>
                </Dropdown>
                {result?.status === 'running' ? (
                  <span className="studio-script-count">
                    {result.completedSteps}/{result.totalSteps}
                  </span>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
