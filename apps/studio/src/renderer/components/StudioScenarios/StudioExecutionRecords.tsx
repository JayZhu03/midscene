import type { ScenarioRunState } from '@midscene/playground';
import { Button } from 'antd';
import { useContext, useEffect, useState } from 'react';
import { t } from '../../i18n';
import { StudioPlaygroundContext } from '../../playground/useStudioPlayground';
import { BackIcon } from '../Recorder/assets/recorder-icons';
import { StudioScenarioReport } from './StudioScenarioReport';

interface ReportEntry {
  id: string;
  name?: string;
  finishedAt?: number;
}

export function StudioExecutionRecords() {
  const playground = useContext(StudioPlaygroundContext);
  const serverUrl = playground?.phase === 'ready' ? playground.serverUrl : null;
  const [records, setRecords] = useState<ReportEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [run, setRun] = useState<ScenarioRunState | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!serverUrl) {
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
          else setRecords(data.reports);
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
  }, [serverUrl, selected]);
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
          {selected ? t('Test report') : t('Execution records')}
        </h3>
        <span />
      </header>
      <div className="studio-execution-body">
        {error ? (
          <p className="studio-scenario-error" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? (
          <div className="studio-scenario-empty">{t('Loading reports')}</div>
        ) : run ? (
          <StudioScenarioReport key={run.id} run={run} autoOpen />
        ) : !records.length ? (
          <div className="studio-scenario-empty">
            {t('No execution records yet')}
          </div>
        ) : !selected ? (
          <ul className="studio-report-list">
            {records.map((record) => (
              <li key={record.id}>
                <button type="button" onClick={() => setSelected(record.id)}>
                  <span>{record.name || t('Test report')}</span>
                  <time>
                    {record.finishedAt
                      ? new Date(record.finishedAt).toLocaleString()
                      : ''}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
