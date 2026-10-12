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
  dirty = false,
  busy = false,
}: {
  steps: ScenarioScriptStep[];
  script: ScenarioScript | null;
  getScreenshotAssetUrl?: (assetId: string) => string | null;
  onChange?: (steps: ScenarioScriptStep[]) => void;
  onSave?: () => void;
  onCancel?: () => void;
  dirty?: boolean;
  busy?: boolean;
}) {
  useStudioLanguage();
  const checkpointTitle = t('Checkpoint');
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string>();
  useEffect(() => {
    if (!dirty) setEditingId(undefined);
  }, [dirty, script?.id]);
  useEffect(() => {
    scrollContainerRef.current
      ?.querySelector<HTMLTextAreaElement>('textarea')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [editingId]);
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
      if (step.type === 'agent-operation' && !step.sourceEvent) {
        const instruction = step.instruction;
        const label = t('Agent operation');
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
          ...(step.type === 'agent-operation'
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
          step.type === 'agent-operation' ? step.instruction : step.description,
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
              key: 'agent-assertion',
              label: t('Add assertion'),
              icon: <CheckIcon />,
            },
            {
              key: 'agent-operation',
              label: t('Add Agent operation'),
              icon: <EditIcon />,
            },
          ],
          onClick: ({ key }) => {
            if (busy || !onChange) return;
            const step = createAgentStep(
              key as 'agent-assertion' | 'agent-operation',
            );
            onChange([...steps.slice(0, index), step, ...steps.slice(index)]);
            setEditingId(step.id);
          },
        }}
      >
        <Button
          type="text"
          size="small"
          disabled={busy}
          aria-label={`${t('Insert step')} ${index + 1}`}
          title={t('Insert step')}
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
          autoScroll={!script}
          renderGap={onChange ? insertAt : undefined}
          renderActions={
            onChange
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
                          if (key === 'edit') setEditingId(step.id);
                          else
                            onChange(
                              steps.filter((item) => item.id !== step.id),
                            );
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
            onChange
              ? (index) => {
                  const step = steps[index];
                  if (
                    step.type === 'playwright-operation' ||
                    editingId !== step.id
                  )
                    return null;
                  return (
                    <Input.TextArea
                      autoFocus
                      aria-label={t('Step instruction')}
                      placeholder={t(
                        step.type === 'agent-assertion'
                          ? 'Describe the expected result'
                          : 'Describe what Agent should do',
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
      {dirty ? (
        <div className="studio-script-editor-footer">
          <Button disabled={busy} onClick={onCancel}>
            {t('Cancel')}
          </Button>
          <Button
            type="primary"
            loading={busy}
            disabled={
              busy ||
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
