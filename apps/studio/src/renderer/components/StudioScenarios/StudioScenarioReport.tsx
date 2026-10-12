import type { ScenarioRunState } from '@midscene/playground';
import { Button, Drawer, message } from 'antd';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { t } from '../../i18n';
import { saveStudioRecorderFile } from '../../recorder/export';
import { DownloadIcon, TimelineIcon } from '../Recorder/assets/recorder-icons';

export function StudioScenarioReport({
  run,
  autoOpen = false,
}: { run: ScenarioRunState; autoOpen?: boolean }) {
  const [open, setOpen] = useState(autoOpen);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string>();
  const [messageApi, messageHolder] = message.useMessage();
  const summary = run.summary;
  const markdown = summary?.format === 'markdown' ? summary.text : undefined;
  const generating =
    !summary || summary.status === 'generating' || summary.phase === 'saving';
  const available = !generating && Boolean(summary?.text);
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
    if (!markdown || downloading) return;
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
          .slice(0, 80)}-${run.id.slice(0, 8)}.md`,
        content: markdown,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
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
        width="min(760px, 92vw)"
        open={open && available}
        onClose={() => setOpen(false)}
        destroyOnClose
        rootClassName="studio-report-drawer"
        title={
          <div className="studio-report-heading">
            <span>{t('Test report')}</span>
            {markdown ? (
              <button
                className="studio-report-download"
                type="button"
                disabled={downloading}
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
        {markdown ? (
          <div className="studio-report-markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              components={{
                img: () => null,
                a: ({ children }) => <span>{children}</span>,
              }}
            >
              {markdown}
            </ReactMarkdown>
          </div>
        ) : summary?.status === 'completed' ? (
          <p>{summary.text}</p>
        ) : null}
      </Drawer>
    </section>
  );
}
