import { t, useStudioLanguage } from '../../i18n';

interface ModelConfigCardProps {
  complete: boolean;
  onOpen?: () => void;
}

export function ModelConfigCard({ complete, onOpen }: ModelConfigCardProps) {
  useStudioLanguage();
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-2 text-[12px] text-text-secondary">
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${complete ? 'bg-status-success' : 'bg-status-error'}`}
      />
      <span>{t(complete ? 'Model configured' : 'Model not configured')}</span>
      {onOpen ? (
        <button
          type="button"
          aria-label={t(
            complete ? 'Edit model configuration' : 'Configure model',
          )}
          className="app-no-drag cursor-pointer rounded border-0 bg-transparent px-1 py-1 text-[12px] text-brand hover:underline"
          onClick={onOpen}
        >
          {t(complete ? 'Edit' : 'Configure')}
        </button>
      ) : null}
    </div>
  );
}
