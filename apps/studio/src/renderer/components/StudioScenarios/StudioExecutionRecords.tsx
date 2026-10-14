import type {
  ScenarioReportEntry,
  ScenarioRunState,
} from '@midscene/playground';
import { Button } from 'antd';
import { useContext, useEffect, useState } from 'react';
import { t } from '../../i18n';
import { StudioPlaygroundContext } from '../../playground/useStudioPlayground';
import {
  ArrowIcon,
  BackIcon,
  ReloadIcon,
} from '../Recorder/assets/recorder-icons';
import { StudioScenarioExecution } from './StudioScenarioExecution';
import { runStatusLabel } from './StudioScriptSequence';

export function StudioExecutionRecords() {
  const playground = useContext(StudioPlaygroundContext);
  const platformId =
    playground?.phase === 'ready' &&
    (playground.controller.state.runtimeInfo?.platformId ||
      playground.controller.state.formValues?.platformId) === 'android'
      ? 'android'
      : 'web';
  const serverUrl = playground?.phase === 'ready' ? playground.serverUrl : null;
  const [records, setRecords] = useState<ScenarioReportEntry[]>([]);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [run, setRun] = useState<ScenarioRunState | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!serverUrl) {
      setRun(null);
      setRecords([]);
      setError(undefined);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    setRun(null);
    const load = async () => {
      try {
        const response = await fetch(
          `${serverUrl.replace(/\/$/, '')}/scenario-reports${selected ? `/${encodeURIComponent(selected)}` : ''}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error('Unable to read execution reports.');
        const data = await response.json();
        if (!controller.signal.aborted) {
          if (selected) setRun(data.run);
          else
            setRecords(
              data.reports.filter(
                (record: ScenarioReportEntry) =>
                  (record.platformId || 'web') === platformId,
              ),
            );
        }
      } catch {
        if (!controller.signal.aborted)
          setError(t('Unable to read execution reports.'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [serverUrl, selected, revision, platformId]);
  useEffect(() => {
    setSelected(null);
    setRun(null);
  }, [platformId]);
  if (selected && run && !loading && serverUrl) {
    return (
      <StudioScenarioExecution
        run={run}
        error={null}
        pending={false}
        ready={false}
        backLabel="Back to execution records"
        onBack={() => setSelected(null)}
        onNext={() => {}}
        onStop={() => {}}
      />
    );
  }
  return (
    <div className="studio-scenario-panel studio-scenario-detail studio-report-records">
      <header className="studio-scenario-toolbar studio-scenario-toolbar-detail">
        {selected ? (
          <Button
            type="text"
            className="studio-scenario-back"
            icon={<BackIcon />}
            aria-label={t('Back to execution records')}
            onClick={() => setSelected(null)}
          />
        ) : (
          <span />
        )}
        <h3 className="studio-scenario-detail-title">
          {t('Execution records')}
        </h3>
        <Button
          type="text"
          icon={<ReloadIcon />}
          aria-label={t('Refresh records')}
          title={t('Refresh records')}
          disabled={!serverUrl || loading}
          onClick={() => setRevision((n) => n + 1)}
        />
      </header>
      {!selected ? (
        <p className="studio-record-retention">
          {t(
            'Only the latest 10 execution records are retained. Download reports you want to keep.',
          )}
        </p>
      ) : null}
      <div className="studio-execution-body">
        {error ? (
          <p className="studio-scenario-error" role="alert">
            {error}
          </p>
        ) : null}
        {!serverUrl ? (
          <div className="studio-scenario-empty">
            {t('Connect a webpage to view execution records')}
          </div>
        ) : loading ? (
          <div className="studio-scenario-empty">{t('Loading reports')}</div>
        ) : error ? null : !records.length ? (
          <div className="studio-scenario-empty">
            {t('No execution records yet')}
          </div>
        ) : !selected ? (
          <ul className="studio-report-list">
            {records.map((record) => (
              <li key={record.id}>
                <button type="button" onClick={() => setSelected(record.id)}>
                  <span className="studio-record-heading">
                    <span className="studio-record-name" title={record.name}>
                      {record.name || t('Test report')}
                    </span>
                    <span
                      className="studio-record-status"
                      data-status={record.status}
                    >
                      {record.status === 'completed'
                        ? t('Completed')
                        : record.status === 'failed'
                          ? t('Has failures')
                          : runStatusLabel(record.status)}
                    </span>
                    <ArrowIcon />
                  </span>
                  <span className="studio-record-meta">
                    <span>
                      {t(
                        record.scope === 'script'
                          ? 'Single script'
                          : 'Scenario execution',
                      )}
                      {record.scope === 'script' && record.scenarioName
                        ? ` · ${record.scenarioName}`
                        : ''}
                    </span>
                    <time
                      dateTime={
                        record.startedAt || record.finishedAt
                          ? new Date(
                              record.startedAt || record.finishedAt!,
                            ).toISOString()
                          : undefined
                      }
                    >
                      {record.startedAt || record.finishedAt
                        ? new Date(
                            record.startedAt || record.finishedAt!,
                          ).toLocaleString()
                        : '—'}
                    </time>
                    {record.startedAt !== undefined &&
                    record.finishedAt !== undefined ? (
                      <span>
                        {t('Duration')}{' '}
                        {Math.max(
                          0,
                          (record.finishedAt - record.startedAt) / 1000,
                        ).toFixed(1)}{' '}
                        s
                      </span>
                    ) : null}
                  </span>
                  <span className="studio-record-counts">
                    {record.counts ? (
                      <span>
                        {t('Scripts')}:{' '}
                        {Object.entries(record.counts)
                          .filter(([, count]) => count > 0)
                          .map(
                            ([status, count]) =>
                              `${status === 'pending' ? t('Not executed') : runStatusLabel(status)} ${count}`,
                          )
                          .join(' · ')}
                      </span>
                    ) : null}
                    {record.recoveryCount > 0 ? (
                      <span className="studio-record-recovery">
                        {t('Agent recovery')} {record.recoveryCount}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
