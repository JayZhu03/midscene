import type { ScenarioStepResult } from '@midscene/playground';
import {
  RecordTimeline,
  type RecordTimelineEntry,
} from '@midscene/recorder-ui';
import { Button, Dropdown, Input } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { t, useStudioLanguage } from '../../i18n';
import {
  CheckIcon,
  EditIcon,
  TrashIcon,
} from '../Recorder/assets/recorder-icons';
import { runStatusLabel } from './StudioScriptSequence';
import {
  type ScenarioScript,
  type ScenarioScriptStep,
  agentStepInstruction,
  createAgentStep,
} from './script-model';
import { getScenarioScriptAsset } from './script-storage';
import '../Recorder/studio-recorder-panel.css';

export function StudioScenarioTimeline({
  steps,
  script,
  getScreenshotAssetUrl,
  onChange,
  onSave,
  onCancel,
  editingStepId,
  onEditStep,
  dirty = false,
  busy = false,
  replay,
}: {
  steps: ScenarioScriptStep[];
  script: ScenarioScript | null;
  getScreenshotAssetUrl?: (assetId: string) => string | null;
  onChange?: (steps: ScenarioScriptStep[]) => void;
  onSave?: () => void;
  onCancel?: () => void;
  editingStepId?: string;
  onEditStep?: (id: string | undefined) => void;
  dirty?: boolean;
  busy?: boolean;
  replay?: { steps: ScenarioStepResult[]; active: boolean };
}) {
  useStudioLanguage();
  const checkpointTitle = t('Checkpoint');
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const replayResults = useMemo(
    () => new Map(replay?.steps.map((step) => [step.id, step])),
    [replay?.steps],
  );
  const currentReplayStep = replay?.steps.find(
    (step) => step.status === 'running',
  )?.id;
  useEffect(() => {
    if (!replay?.active || !currentReplayStep) return;
    const marker = scrollContainerRef.current?.querySelector(
      '[data-replay-status="running"]',
    );
    marker?.closest('[data-entry-id]')?.scrollIntoView?.({
      block: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  }, [currentReplayStep, replay?.active]);
  useEffect(() => {
    scrollContainerRef.current
      ?.querySelector<HTMLTextAreaElement>('textarea')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [editingStepId]);
  useEffect(() => {
    let disposed = false;
    const created: string[] = [];
    setAssetUrls({});
    if (script) {
      void Promise.all(
        script.assets.map(async (asset) => {
          const blob = await getScenarioScriptAsset(asset.id);
          if (!blob || disposed) return null;
          const url = URL.createObjectURL(blob);
          created.push(url);
          return [asset.id, url] as const;
        }),
      )
        .then((results) => {
          if (!disposed)
            setAssetUrls(
              Object.fromEntries(results.filter((result) => result !== null)),
            );
        })
        .catch(() => {
          // Keep the source data intact if a preview cannot be loaded.
        });
    }
    return () => {
      disposed = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [script]);

  const entries = useMemo<RecordTimelineEntry[]>(() => {
    const imageUrl = (value?: string) =>
      value?.startsWith('scenario-asset:')
        ? assetUrls[value.slice('scenario-asset:'.length)]
        : value;
    return steps.map((step) => {
      if (
        (step.type === 'agent-operation' || step.type === 'agent-task') &&
        !step.sourceEvent
      ) {
        const instruction = step.instruction;
        const label = t(
          step.type === 'agent-task'
            ? 'Operation or assertion'
            : 'Agent operation',
        );
        return {
          id: step.id,
          description: (
            <span>
              {label} - {instruction}
            </span>
          ),
          descriptionText: `${label} - ${instruction}`,
          icon: (
            <span className="studio-scenario-checkpoint-icon">
              <CheckIcon />
            </span>
          ),
          details: instruction,
          color: 'var(--midscene-brand)',
        };
      }
      if (step.type === 'agent-assertion') {
        return {
          id: step.id,
          description: (
            <span>
              {checkpointTitle} - {step.instruction}
            </span>
          ),
          descriptionText: `${checkpointTitle} - ${step.instruction}`,
          icon: (
            <span className="studio-scenario-checkpoint-icon">
              <CheckIcon />
            </span>
          ),
          color: 'var(--midscene-brand)',
          details: step.instruction,
        };
      }
      const source = step.sourceEvent!;
      const screenshotAssetUrl = source.screenshotAsset
        ? script
          ? assetUrls[source.screenshotAsset.id]
          : getScreenshotAssetUrl?.(source.screenshotAsset.id)
        : null;
      return {
        event: {
          ...source,
          ...(step.type === 'agent-operation' || step.type === 'agent-task'
            ? {
                semantic: {
                  ...source.semantic,
                  source: 'heuristic' as const,
                  status: 'ready' as const,
                  actionSummary: step.instruction,
                  replayInstruction: step.instruction,
                },
              }
            : {}),
          screenshotWithBox: imageUrl(source.screenshotWithBox),
          screenshotAfter:
            imageUrl(source.screenshotAfter) ||
            screenshotAssetUrl ||
            imageUrl(source.screenshotBefore) ||
            undefined,
          screenshotBefore: imageUrl(source.screenshotBefore),
        },
        details:
          step.type !== 'playwright-operation'
            ? step.instruction
            : step.description,
      };
    });
  }, [steps, script, assetUrls, getScreenshotAssetUrl, checkpointTitle]);

  const insertAt = (index: number) => (
    <div
      className={`studio-script-insert${index === 0 ? ' studio-script-insert-first' : ''}`}
    >
      <Dropdown
        trigger={['click']}
        disabled={busy}
        overlayClassName="studio-scenario-menu"
        menu={{
          items: [
            {
              key: 'agent-task',
              label: t('Add operation or assertion'),
              icon: <EditIcon />,
            },
          ],
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
            if (busy || !onChange) return;
            const step = createAgentStep('agent-task');
            onChange([...steps.slice(0, index), step, ...steps.slice(index)]);
            onEditStep?.(step.id);
          },
        }}
      >
        <Button
          type="text"
          size="small"
          disabled={busy}
          aria-label={`${t('Insert step')} ${index + 1}`}
          title={t('Add operation or assertion')}
        >
          +
        </Button>
      </Dropdown>
    </div>
  );
  return steps.length || onChange ? (
    <>
      <div
        className="studio-recorder-timeline studio-scenario-timeline"
        ref={scrollContainerRef}
      >
        <RecordTimeline
          events={[]}
          entries={entries}
          layout="parent-scroll"
          scrollContainerRef={scrollContainerRef}
          autoScroll={!script && !replay}
          renderGap={onChange ? insertAt : undefined}
          renderActions={
            replay
              ? (index) => {
                  const result = replayResults.get(steps[index].id);
                  const status = result?.status ?? 'pending';
                  const label =
                    result?.recovery?.status === 'running'
                      ? t('Agent taking over')
                      : result?.recovery?.status === 'recovered'
                        ? t('Passed · Agent recovery')
                        : status === 'pending' && !replay.active
                          ? t('Not executed')
                          : runStatusLabel(status);
                  return (
                    <span
                      className="studio-draft-step-status"
                      data-replay-status={status}
                    >
                      {label}
                    </span>
                  );
                }
              : onChange
                ? (index) => {
                    const step = steps[index];
                    if (step.type === 'playwright-operation') return null;
                    return (
                      <Dropdown
                        trigger={['click']}
                        disabled={busy}
                        overlayClassName="studio-scenario-menu"
                        menu={{
                          items: [
                            {
                              key: 'edit',
                              label: t('Edit step'),
                              icon: <EditIcon />,
                            },
                            {
                              key: 'delete',
                              label: t('Delete'),
                              icon: <TrashIcon />,
                              danger: true,
                            },
                          ],
                          onClick: ({ key, domEvent }) => {
                            domEvent.stopPropagation();
                            if (busy) return;
                            if (key === 'edit') onEditStep?.(step.id);
                            else {
                              onChange(
                                steps.filter((item) => item.id !== step.id),
                              );
                              if (editingStepId === step.id)
                                onEditStep?.(undefined);
                            }
                          },
                        }}
                      >
                        <Button
                          type="text"
                          size="small"
                          disabled={busy}
                          aria-label={`${t('Step actions')} ${index + 1}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          •••
                        </Button>
                      </Dropdown>
                    );
                  }
                : undefined
          }
          renderEditor={
            replay
              ? (index) => {
                  const result = replayResults.get(steps[index].id);
                  const detail =
                    result?.error ||
                    (result?.status === 'failed' ? result.detail : undefined);
                  return detail ? (
                    <div className="studio-draft-step-error" role="alert">
                      {t(detail)}
                    </div>
                  ) : null;
                }
              : onChange
                ? (index) => {
                    const step = steps[index];
                    if (
                      step.type === 'playwright-operation' ||
                      editingStepId !== step.id
                    )
                      return null;
                    return (
                      <Input.TextArea
                        autoFocus
                        aria-label={t('Step instruction')}
                        placeholder={t(
                          'Describe an operation, expected result or wait',
                        )}
                        autoSize={{ minRows: 2, maxRows: 8 }}
                        maxLength={100000}
                        disabled={busy}
                        value={step.instruction}
                        onChange={(event) =>
                          onChange(
                            steps.map((item) =>
                              item.id === step.id
                                ? agentStepInstruction(item, event.target.value)
                                : item,
                            ),
                          )
                        }
                      />
                    );
                  }
                : undefined
          }
        />
      </div>
      {dirty || editingStepId ? (
        <div className="studio-script-editor-footer">
          <Button disabled={busy} onClick={onCancel}>
            {t('Cancel')}
          </Button>
          <Button
            type="primary"
            loading={busy}
            disabled={
              busy ||
              !dirty ||
              !steps.length ||
              steps.some(
                (step) =>
                  step.type !== 'playwright-operation' &&
                  !step.instruction.trim(),
              )
            }
            onClick={onSave}
          >
            {t('Save changes')}
          </Button>
        </div>
      ) : null}
    </>
  ) : (
    <div className="studio-scenario-empty">{t('No recorded steps yet')}</div>
  );
}
