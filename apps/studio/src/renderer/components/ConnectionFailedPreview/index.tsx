import { t, useStudioLanguage } from '../../i18n';
export interface ConnectionFailedPreviewProps {
  pageUrl?: string;
  description?: string;
  className?: string;
  iconSrc: string;
  onReconnect?: () => void;
}

export default function ConnectionFailedPreview({
  pageUrl,
  description = 'Unable to connect to this page.',
  className,
  iconSrc,
  onReconnect,
}: ConnectionFailedPreviewProps) {
  useStudioLanguage();

  const rootClassName = [
    'flex h-full w-full items-center justify-center bg-surface',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName}>
      <div className="flex w-[190px] flex-col items-center">
        <div className="flex justify-center">
          <img
            alt=""
            aria-hidden="true"
            className="h-6 w-6 object-contain"
            src={iconSrc}
          />
        </div>

        <div className="mt-[4px] w-[130px] overflow-hidden whitespace-nowrap text-center text-[13px] font-medium leading-[24px] text-text-primary">
          {t('Connection failed')}
        </div>

        <div
          title={pageUrl}
          className="mt-[4px] w-[190px] break-words text-center text-[12px] leading-[20px] text-text-secondary"
        >
          {t(description)}
        </div>

        <button
          className="mt-[12px] flex h-8 cursor-pointer appearance-none items-center justify-center rounded-[8px] border-0 bg-surface-muted px-[16px] text-[13px] font-medium leading-[22px] text-text-primary transition-colors hover:bg-surface-hover-strong active:bg-surface-active"
          onClick={onReconnect}
          type="button"
        >
          {t('Reconnect')}
        </button>
      </div>
    </div>
  );
}
