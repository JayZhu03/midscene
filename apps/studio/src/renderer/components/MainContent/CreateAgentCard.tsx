import { DEFAULT_STUDIO_WEB_VIEWPORT } from '@shared/web-viewport';
import { useState } from 'react';
import { assetUrls } from '../../assets';
import { t, useStudioLanguage } from '../../i18n';
import {
  loadSavedWebPages,
  normalizeSavedWebPage,
} from '../../playground/saved-web-pages';
import { MaskedIcon } from '../MaskedIcon';

export interface WebCreateInput {
  url: string;
  viewportWidth: number;
  viewportHeight: number;
  headed: boolean;
}

interface BaseCardProps {
  title: string;
  iconColor?: string;
  busy?: boolean;
  submitLabel: string;
  busyLabel?: string;
  children: React.ReactNode;
  onSubmit: () => void;
}

function ChevronDown({ flipped }: { flipped: boolean }) {
  useStudioLanguage();

  return (
    <svg
      aria-hidden="true"
      className={`shrink-0 transition-transform ${flipped ? 'rotate-180' : ''}`}
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <path
        d="M4 6L8 10L12 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function WebIcon() {
  useStudioLanguage();

  return (
    <MaskedIcon
      className="h-[14px] w-[14px] text-text-primary"
      src={assetUrls.main.platformWeb}
    />
  );
}

function CardShell({
  busy,
  busyLabel,
  children,
  onSubmit,
  submitLabel,
  title,
}: BaseCardProps) {
  useStudioLanguage();

  const [expanded, setExpanded] = useState(true);

  return (
    <div className="w-full shrink-0 overflow-hidden rounded-[12px] bg-surface-muted">
      <button
        className="flex h-[48px] w-full cursor-pointer appearance-none items-center justify-between border-0 bg-transparent px-[16px] text-left"
        onClick={() => setExpanded((prev) => !prev)}
        type="button"
      >
        <span className="flex items-center gap-[8px]">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-active">
            <WebIcon />
          </span>
          <span className="text-[14px] font-medium leading-[16px] text-text-primary">
            {t(title)}
          </span>
        </span>
        <span className="flex items-center text-text-secondary">
          <ChevronDown flipped={expanded} />
        </span>
      </button>
      {expanded ? (
        <div className="border-t border-border-subtle">
          <div className="px-[20px] py-[16px]">{children}</div>
          <div className="flex justify-end px-[20px] pb-[16px]">
            <button
              className="h-[32px] cursor-pointer appearance-none rounded-[8px] border border-brand bg-brand px-[16px] text-[14px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              onClick={onSubmit}
              type="button"
            >
              {t(busy ? (busyLabel ?? 'Submitting…') : submitLabel)}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  useStudioLanguage();

  return (
    <div className="mb-[8px] text-[13px] font-medium leading-[20px] text-text-primary">
      {children}
      {required ? <span className="ml-[2px] text-[#E53935]">*</span> : null}
    </div>
  );
}

const inputBaseClass =
  'box-border h-[36px] w-full rounded-[8px] border border-border-subtle bg-surface px-[12px] text-[14px] leading-[17px] text-text-primary placeholder:text-text-placeholder focus:border-brand focus:outline-none';

function NumberInput({
  ariaLabel,
  onChange,
  prefix,
  value,
}: {
  ariaLabel: string;
  onChange: (next: number) => void;
  prefix: string;
  value: number;
}) {
  useStudioLanguage();

  return (
    <div className="box-border flex h-[36px] min-w-0 flex-1 items-center rounded-[8px] border border-border-subtle bg-surface px-[12px]">
      <span className="mr-[8px] shrink-0 text-[14px] leading-[17px] text-text-placeholder">
        {prefix}
      </span>
      <input
        aria-label={ariaLabel}
        className="h-full w-0 min-w-0 flex-1 border-0 bg-transparent text-[14px] leading-[17px] text-text-primary placeholder:text-text-placeholder focus:outline-none"
        inputMode="numeric"
        min={1}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) {
            onChange(next);
          }
        }}
        type="number"
        value={value}
      />
    </div>
  );
}

export interface WebCreateAgentCardProps {
  busy?: boolean;
  defaultUrl?: string;
  defaultViewportWidth?: number;
  defaultViewportHeight?: number;
  defaultHeaded?: boolean;
  onSubmit: (input: WebCreateInput) => void | Promise<void>;
}

export function WebCreateAgentCard({
  busy,
  defaultHeaded = false,
  defaultUrl = 'https://example.com',
  defaultViewportHeight = DEFAULT_STUDIO_WEB_VIEWPORT.height,
  defaultViewportWidth = DEFAULT_STUDIO_WEB_VIEWPORT.width,
  onSubmit,
}: WebCreateAgentCardProps) {
  useStudioLanguage();

  const [saved] = useState(() => loadSavedWebPages()[0]);
  const [url, setUrl] = useState(saved?.url ?? defaultUrl);
  const [width, setWidth] = useState(
    saved?.viewportWidth ?? defaultViewportWidth,
  );
  const [height, setHeight] = useState(
    saved?.viewportHeight ?? defaultViewportHeight,
  );
  const [headed, setHeaded] = useState(saved?.headed ?? defaultHeaded);
  const [error, setError] = useState('');

  return (
    <CardShell
      busy={busy}
      busyLabel={t('Opening…')}
      onSubmit={() => {
        if (busy) return;
        const input = normalizeSavedWebPage({
          url,
          viewportWidth: width,
          viewportHeight: height,
          headed,
        });
        if (!input) {
          setError(t('Please enter a valid HTTP or HTTPS URL.'));
          return;
        }
        setError('');
        void Promise.resolve(onSubmit(input)).catch(() =>
          setError(t('Unable to open page')),
        );
      }}
      submitLabel={t('Open test page')}
      title={t('Open test page')}
    >
      {error ? (
        <div role="alert" className="mb-2 text-status-error">
          {error}
        </div>
      ) : null}
      <div className="grid w-full grid-cols-1 gap-4 min-[1000px]:grid-cols-3">
        <div className="flex min-w-0 flex-col">
          <FieldLabel required>{t('URL')}</FieldLabel>
          <input
            aria-label={t('URL')}
            className={inputBaseClass}
            onChange={(event) => setUrl(event.target.value)}
            onBlur={() => {
              const next = normalizeSavedWebPage({ url });
              const previous =
                next &&
                loadSavedWebPages().find((page) => page.url === next.url);
              if (previous) {
                setWidth(previous.viewportWidth);
                setHeight(previous.viewportHeight);
                setHeaded(previous.headed);
              }
            }}
            placeholder="https://example.com"
            type="text"
            value={url}
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <FieldLabel>{t('Page size')}</FieldLabel>
          <div className="grid w-full grid-cols-2 gap-[8px]">
            <NumberInput
              ariaLabel={t('Page width')}
              onChange={setWidth}
              prefix="W"
              value={width}
            />
            <NumberInput
              ariaLabel={t('Page height')}
              onChange={setHeight}
              prefix="H"
              value={height}
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-col">
          <FieldLabel>{t('Browser window')}</FieldLabel>
          <div className="relative h-[36px]">
            <select
              aria-label={t('Browser window mode')}
              className={`${inputBaseClass} appearance-none pr-[32px]`}
              onChange={(event) => setHeaded(event.target.value === 'headed')}
              value={headed ? 'headed' : 'headless'}
            >
              <option value="headless">{t('Headless')}</option>
              <option value="headed">{t('Visible Chrome window')}</option>
            </select>
            <span className="pointer-events-none absolute right-[12px] top-1/2 -translate-y-1/2 text-text-secondary">
              <ChevronDown flipped={false} />
            </span>
          </div>
        </div>
      </div>
    </CardShell>
  );
}
