import type { ScenarioRunState } from '@midscene/playground';
import { Button, Dropdown } from 'antd';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import {
  EditIcon,
  ReplayIcon,
  TrashIcon,
} from '../Recorder/assets/recorder-icons';
import type { ScenarioScript } from './script-model';
import { type SequenceEntry, moveScript } from './sequence';
import { type SessionMode, sessionModeMenu } from './session-mode';
import { TransferIcon } from './useStudioTransfer';

export const runStatusLabel = (status: string) =>
  t(
    (
      {
        pending: 'Not started',
        running: 'Running',
        waiting: 'Waiting for next',
        passed: 'Passed',
        failed: 'Failed',
        blocked: 'Blocked',
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
  sessionMode = 'current',
  onSessionModeChange,
}: {
  scripts: ScenarioScript[];
  sequence: SequenceEntry[];
  locked: boolean;
  run: ScenarioRunState | null;
  onChange: (value: SequenceEntry[]) => void;
  onOpen: (script: ScenarioScript) => void;
  onAction: (
    action: 'rename' | 'delete' | 'run' | 'edit' | 'export',
    script: ScenarioScript,
  ) => void;
  canRun: boolean;
  sessionMode?: SessionMode;
  onSessionModeChange?: (mode: SessionMode) => void;
}) {
  const suppressDragClick = useRef(false);
  const dragFromControl = useRef(false);
  const dragClickTimer = useRef<ReturnType<typeof setTimeout>>();
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const animations = useRef<Animation[]>([]);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>();
  const pendingMove = useRef<{
    id: string;
    order: string;
    positions: Map<string, number>;
  } | null>(null);
  const reorder = (id: string, targetId: string) => {
    const next = moveScript(sequence, id, targetId);
    if (locked || next === sequence) return;
    pendingMove.current = {
      id,
      order: JSON.stringify(next.map((item) => item.id)),
      positions: new Map(
        [...rows.current].map(([key, row]) => [
          key,
          row.getBoundingClientRect().top,
        ]),
      ),
    };
    onChange(next);
  };
  useLayoutEffect(() => {
    const move = pendingMove.current;
    if (!move) return;
    pendingMove.current = null;
    // Animate only after the parent has successfully saved and accepted the order.
    if (JSON.stringify(sequence.map((item) => item.id)) !== move.order) return;
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const [id, row] of rows.current) {
        const previous = move.positions.get(id);
        if (previous === undefined) continue;
        const offset = previous - row.getBoundingClientRect().top;
        if (offset && row.animate)
          animations.current.push(
            row.animate(
              [
                { transform: `translateY(${offset}px)` },
                { transform: 'translateY(0)' },
              ],
              { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
            ),
          );
      }
    }
    clearTimeout(highlightTimer.current);
    setLanded(move.id);
    highlightTimer.current = setTimeout(() => setLanded(null), 1400);
  }, [sequence]);
  useEffect(
    () => () => {
      clearTimeout(highlightTimer.current);
      clearTimeout(dragClickTimer.current);
      animations.current.forEach((animation) => animation.cancel());
    },
    [],
  );
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
            ref={(node) => {
              if (node) rows.current.set(entry.id, node);
              else rows.current.delete(entry.id);
            }}
            className={`studio-sequence-row${over === entry.id && dragged !== entry.id ? ' studio-sequence-drop' : ''}`}
            data-dragging={dragged === entry.id ? 'true' : undefined}
            data-landed={landed === entry.id ? 'true' : undefined}
            data-drop-position={
              over === entry.id && dragged && dragged !== entry.id
                ? sequence.findIndex((item) => item.id === dragged) < index
                  ? 'after'
                  : 'before'
                : undefined
            }
            data-status={result?.status}
            draggable={!locked}
            onPointerDownCapture={(event) => {
              suppressDragClick.current = false;
              clearTimeout(dragClickTimer.current);
              dragFromControl.current = Boolean(
                (event.target as HTMLElement).closest(
                  'button:not(.studio-sequence-name), a, input, textarea, [role="menuitem"]',
                ),
              );
            }}
            onClick={(event) => {
              const target = event.target as HTMLElement;
              // Dropdown menus render through a portal; their clicks must not open the row.
              if (
                !event.currentTarget.contains(target) ||
                target.closest('button, a, input, textarea, [role="menuitem"]')
              )
                return;
              onOpen(script);
            }}
            onClickCapture={(event) => {
              if (suppressDragClick.current && event.detail !== 0) {
                event.preventDefault();
                event.stopPropagation();
                suppressDragClick.current = false;
              }
            }}
            onDragStart={(event) => {
              if (locked || dragFromControl.current) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.setData('text/plain', entry.id);
              event.dataTransfer.effectAllowed = 'move';
              suppressDragClick.current = true;
              clearTimeout(highlightTimer.current);
              setLanded(null);
              setDragged(entry.id);
            }}
            onDragEnd={() => {
              setDragged(null);
              setOver(null);
              dragClickTimer.current = setTimeout(() => {
                suppressDragClick.current = false;
              }, 250);
            }}
            onDragOver={(event) => {
              if (!locked && dragged) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setOver(entry.id);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (!locked && dragged) reorder(dragged, entry.id);
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
                    if (target) reorder(entry.id, target.id);
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
                    selectedKeys: [`session-${sessionMode}`],
                    items: [
                      {
                        key: 'export',
                        label: t('Export script'),
                        icon: <TransferIcon />,
                      },
                      {
                        key: 'edit',
                        label: t('Edit script'),
                        icon: <EditIcon />,
                      },
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
                      ...(onSessionModeChange
                        ? [
                            sessionModeMenu(
                              sessionMode,
                              false,
                              script.sourceSession.target.platformId ===
                                'android',
                            ),
                          ]
                        : []),
                    ],
                    onClick: ({ key }) => {
                      if (
                        !locked &&
                        (key === 'session-current' || key === 'session-fresh')
                      ) {
                        onSessionModeChange?.(
                          key === 'session-fresh' ? 'fresh' : 'current',
                        );
                        return;
                      }
                      if (
                        !locked &&
                        (key === 'rename' ||
                          key === 'export' ||
                          key === 'delete' ||
                          key === 'run' ||
                          key === 'edit')
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
                        if (target) reorder(entry.id, target.id);
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
