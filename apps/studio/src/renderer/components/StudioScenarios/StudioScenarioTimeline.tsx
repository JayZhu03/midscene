import {
  RecordTimeline,
  type RecordTimelineEntry,
} from '@midscene/recorder-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { t, useStudioLanguage } from '../../i18n';
import { CheckIcon } from '../Recorder/assets/recorder-icons';
import type { ScenarioScript, ScenarioScriptStep } from './script-model';
import { getScenarioScriptAsset } from './script-storage';
import '../Recorder/studio-recorder-panel.css';

export function StudioScenarioTimeline({
  steps,
  script,
  getScreenshotAssetUrl,
}: {
  steps: ScenarioScriptStep[];
  script: ScenarioScript | null;
  getScreenshotAssetUrl?: (assetId: string) => string | null;
}) {
  useStudioLanguage();
  const checkpointTitle = t('Checkpoint');
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
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

  return steps.length ? (
    <div
      className="studio-recorder-timeline studio-scenario-timeline"
      ref={scrollContainerRef}
    >
      <RecordTimeline
        events={[]}
        entries={entries}
        layout="parent-scroll"
        scrollContainerRef={scrollContainerRef}
      />
    </div>
  ) : (
    <div className="studio-scenario-empty">{t('No recorded steps yet')}</div>
  );
}
