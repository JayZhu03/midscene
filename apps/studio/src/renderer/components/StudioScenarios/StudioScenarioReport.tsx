import {
  type ScenarioRunState,
  composeScenarioHtml,
} from '@midscene/playground';
import { Button, Drawer, message } from 'antd';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { StudioPlaygroundContext } from '../../playground/useStudioPlayground';
import { saveStudioRecorderFile } from '../../recorder/export';
import { coverNativePreview } from '../MainContent/native-preview-cover';
import { DownloadIcon, TimelineIcon } from '../Recorder/assets/recorder-icons';

export function StudioScenarioReport({
  run,
  autoOpen = false,
}: { run: ScenarioRunState; autoOpen?: boolean }) {
  const [open, setOpen] = useState(autoOpen);
  const [coverReady, setCoverReady] = useState(false);
  const releaseCover = useRef<() => void>();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string>();
  const [messageApi, messageHolder] = message.useMessage();
  const summary = run.summary;
  const playground = useContext(StudioPlaygroundContext);
  const serverUrl =
    playground?.phase === 'ready' ? playground.serverUrl : undefined;
  const fallback = useMemo(
    () => composeScenarioHtml(run),
    [run, summary?.text],
  );
  const [loaded, setLoaded] = useState<{ id: string; html: string }>();
  const [loading, setLoading] = useState(false);
  const html = loaded?.id === run.id ? loaded.html : fallback;
  const generating =
    !summary || summary.status === 'generating' || summary.phase === 'saving';
  const available = !generating && Boolean(summary?.text);
  useEffect(() => {
    if (!open || !available || releaseCover.current) return;
    let cancelled = false;
    void coverNativePreview()
      .then((release) => {
        if (cancelled) return release();
        releaseCover.current = release;
        setCoverReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setOpen(false);
        void messageApi.error(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [open, available, messageApi]);
  useEffect(() => () => releaseCover.current?.(), []);
  useEffect(() => {
    if (!open || !available || !serverUrl) return;
    const abort = new AbortController();
    setLoading(true);
    setError(undefined);
    void fetch(
      `${serverUrl.replace(/\/$/, '')}/scenario-reports/${encodeURIComponent(run.id)}/html`,
      { signal: abort.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('Report unavailable');
        const content = await response.text();
        if (!abort.signal.aborted) setLoaded({ id: run.id, html: content });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError(
            t(
              'Unable to load process evidence. Showing the test conclusion only.',
            ),
          );
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [open, available, serverUrl, run.id]);
  const viewReport = () => {
    if (available) {
      messageApi.destroy('report-status');
      setOpen(true);
    } else {
      void messageApi.open({
        key: 'report-status',
        type: generating ? 'info' : 'error',
        content: t(
          generating
            ? 'Report is being generated. Please wait.'
            : 'Report generation failed',
        ),
      });
    }
  };
  const download = async () => {
    if (!available || downloading || loading) return;
    setDownloading(true);
    setError(undefined);
    const name =
      (run.scope === 'script' ? run.scripts[0]?.name : run.scenarioName) ||
      'report';
    try {
      await saveStudioRecorderFile({
        title: t('Download report'),
        defaultFileName: `${Array.from(name)
          .filter((char) => char.charCodeAt(0) >= 32)
          .join('')
          .replace(/[<>:"/\\|?*]/g, '-')
          .slice(0, 80)}-${run.id.slice(0, 8)}.html`,
        content: html,
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
    } catch {
      setError(t('Unable to download report.'));
    } finally {
      setDownloading(false);
    }
  };
  return (
    <section className="studio-report-entry" aria-label={t('Test report')}>
      {messageHolder}
      <div className="studio-script-actions studio-script-record-strip">
        <Button
          type="primary"
          block
          icon={<TimelineIcon />}
          onClick={viewReport}
        >
          {t('View report')}
        </Button>
      </div>
      <Drawer
        placement="right"
        width="min(1000px, 92vw)"
        open={open && available && coverReady}
        onClose={() => setOpen(false)}
        afterOpenChange={(visible) => {
          if (visible || (open && available)) return;
          releaseCover.current?.();
          releaseCover.current = undefined;
          setCoverReady(false);
        }}
        destroyOnClose
        rootClassName="studio-report-drawer"
        title={
          <div className="studio-report-heading">
            <span>{t('Test report')}</span>
            {available ? (
              <button
                className="studio-report-download"
                type="button"
                disabled={downloading || loading}
                aria-busy={downloading}
                onClick={() => void download()}
              >
                <span
                  className="studio-report-download-icon"
                  aria-hidden="true"
                >
                  <DownloadIcon />
                </span>
                <span className="studio-report-download-label">
                  {t('Download report')}
                </span>
              </button>
            ) : null}
          </div>
        }
      >
        {summary?.storageError ? (
          <p className="studio-scenario-error" role="alert">
            {t(summary.storageError)}
          </p>
        ) : null}
        {error ? (
          <p className="studio-scenario-error" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? <output>{t('Loading report...')}</output> : null}
        <iframe
          className="studio-report-html"
          title={t('Test report')}
          sandbox="allow-scripts"
          allow="fullscreen *"
          allowFullScreen
          srcDoc={html}
        />
      </Drawer>
    </section>
  );
}
