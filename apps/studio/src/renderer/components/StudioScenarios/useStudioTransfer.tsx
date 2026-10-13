import { sanitizeMidsceneRecorderFileName } from '@midscene/shared/recorder';
import { Button, Modal, message } from 'antd';
import { useRef, useState } from 'react';
import { t } from '../../i18n';
import { saveStudioRecorderFile } from '../../recorder/export';
import type { ScenarioScript } from './script-model';
import { listScenarioScripts } from './script-storage';
import { type StudioScenario, loadStudioScenarios } from './storage';
import {
  type PackageKind,
  type PreparedPackage,
  createStudioPackage,
  importStudioPackage,
  readStudioPackage,
} from './transfer';

export function TransferIcon({ upload = false }: { upload?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d={
          upload
            ? 'M8 10V2m-3 3 3-3 3 3M3 10v3h10v-3'
            : 'M8 2v8m-3-3 3 3 3-3M3 10v3h10v-3'
        }
        stroke="currentColor"
        strokeWidth="1.33"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Shared dialog keeps transfer controls out of the recording/execution toolbar. */
export function useStudioTransfer(onImported: () => void | Promise<void>) {
  const [request, setRequest] = useState<{
    kind: PackageKind;
    target?: StudioScenario;
  } | null>(null);
  const [bundle, setBundle] = useState<PreparedPackage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameExists, setNameExists] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const locked = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const open = (next: NonNullable<typeof request>) => {
    if (locked.current) return;
    setRequest(next);
    setBundle(null);
    setError(null);
    setNameExists(false);
  };
  const close = () => {
    if (!locked.current) setRequest(null);
  };
  const readFile = async (file?: File) => {
    if (!file || !request || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setBundle(null);
    setNameExists(false);
    try {
      if (file.size > 100 * 1024 * 1024)
        throw new Error('Studio package is too large.');
      const parsed = await readStudioPackage(
        new Uint8Array(await file.arrayBuffer()),
        request.kind,
      );
      const existing =
        request.kind === 'scenario'
          ? loadStudioScenarios()
          : await listScenarioScripts(request.target!.id);
      const name =
        request.kind === 'scenario'
          ? parsed.manifest.name
          : parsed.manifest.scripts[0].name;
      setNameExists(existing.some((item) => item.name === name));
      setBundle(parsed);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(
        t(
          [
            'Studio package is too large.',
            'Unsupported Studio package version.',
            'Choose a package of the correct type.',
          ].includes(message)
            ? message
            : 'Invalid or incomplete Studio package.',
        ),
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!request || !bundle || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await importStudioPackage(bundle, request.target);
      await onImported();
      setRequest(null);
    } catch (cause) {
      setError(
        t(
          cause instanceof Error &&
            cause.message === 'Studio package is too large.'
            ? cause.message
            : 'Unable to import. Check local storage and retry.',
        ),
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const exportFile = async (
    scenario: StudioScenario,
    script?: ScenarioScript,
  ) => {
    if (locked.current) return;
    locked.current = true;
    try {
      await saveStudioRecorderFile({
        title: t(script ? 'Export script' : 'Export scenario'),
        defaultFileName: `${sanitizeMidsceneRecorderFileName(script?.name ?? scenario.name)}.${script ? 'script' : 'scenario'}.zip`,
        content: async () => {
          const bytes = await createStudioPackage(scenario, script);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 8192)
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          return btoa(binary);
        },
        encoding: 'base64',
        filters: [{ name: 'Studio ZIP', extensions: ['zip'] }],
      });
    } catch (cause) {
      void messageApi.error(
        t(
          cause instanceof Error &&
            cause.message === 'Studio package is too large.'
            ? cause.message
            : 'Unable to export. Check saved scripts and screenshots.',
        ),
      );
    } finally {
      locked.current = false;
    }
  };
  const title =
    request?.kind === 'script' ? 'Import script' : 'Import scenario';
  return {
    openImport: (kind: PackageKind, target?: StudioScenario) =>
      open({ kind, target }),
    openExport: (scenario: StudioScenario, script?: ScenarioScript) =>
      void exportFile(scenario, script),
    dialog: (
      <>
        {contextHolder}
        <Modal
          title={t(title)}
          open={Boolean(request)}
          width={440}
          maskClosable={false}
          closable={!busy}
          keyboard={!busy}
          onCancel={close}
          onOk={() => void confirm()}
          cancelText={t('Cancel')}
          cancelButtonProps={{ disabled: busy }}
          confirmLoading={busy}
          okButtonProps={{ disabled: !bundle }}
          okText={t('Import')}
        >
          <>
            <input
              ref={input}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              icon={<TransferIcon upload />}
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {t(bundle ? 'Choose another file' : 'Choose ZIP file')}
            </Button>
            {bundle ? (
              <div className="studio-transfer-preview">
                <strong className="studio-transfer-name">
                  {bundle.manifest.name}
                </strong>
                {bundle.manifest.description && (
                  <p>{bundle.manifest.description}</p>
                )}
                <p>
                  {t('Scripts')}: {bundle.manifest.scripts.length} ·{' '}
                  {t('Steps')}:{' '}
                  {bundle.manifest.scripts.reduce(
                    (n, s) => n + s.steps.length,
                    0,
                  )}
                </p>
                {nameExists ? (
                  <p className="studio-transfer-note">
                    {t('A copy will be created.')}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
          {error && (
            <p className="studio-scenario-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      </>
    ),
  };
}
