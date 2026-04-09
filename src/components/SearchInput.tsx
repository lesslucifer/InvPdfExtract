import React, { useEffect, useRef, useMemo } from 'react';
import { Icons, ICON_SIZE } from '../shared/icons';
import { t } from '../lib/i18n';
import { useQueueData, useErrorData } from '../lib/queries';
import type { LucideIcon } from 'lucide-react';

type StatusIndicator = 'idle' | 'processing' | 'error';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function getStatusConfig(): Record<StatusIndicator, { icon: LucideIcon; className: string; label: string }> {
  return {
    idle:       { icon: Icons.success,  className: 'text-text-muted',               label: t('all_good_view_processing_log', 'All good — view processing log') },
    processing: { icon: Icons.loader,   className: 'text-accent animate-spin-slow', label: `${t('processing', 'Processing')}...` },
    error:      { icon: Icons.error,    className: 'text-confidence-low',           label: t('error', 'Error') },
  };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (pos: number) => void;
  onStatusDotClick?: () => void;
}

export const SearchInput: React.FC<Props> = ({ value, onChange, onCursorChange, onStatusDotClick }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: queueData } = useQueueData();
  const { data: errorData } = useErrorData();

  const status: StatusIndicator = useMemo(() => {
    const queueFiles = queueData?.files ?? [];
    const jeQueueItems = queueData?.jeItems ?? [];
    if (queueFiles.length > 0 || jeQueueItems.length > 0) return 'processing';

    const now = Date.now();
    const errorLogs = errorData?.logs ?? [];
    const jeErrors = errorData?.jeErrors ?? [];
    const hasRecentError = errorLogs.some(l => now - new Date(l.timestamp).getTime() < SIX_HOURS_MS)
      || jeErrors.some(e => now - new Date(e.updated_at).getTime() < SIX_HOURS_MS);
    if (hasRecentError) return 'error';

    return 'idle';
  }, [queueData, errorData]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    if (onCursorChange) {
      onCursorChange(e.target.selectionStart ?? e.target.value.length);
    }
  };

  const handleSelect = () => {
    if (onCursorChange && inputRef.current) {
      onCursorChange(inputRef.current.selectionStart ?? value.length);
    }
  };

  const statusConfig = getStatusConfig()[status];

  return (
    <div className="flex items-center px-4 py-3 border-b border-border gap-2.5">
      <span className="inline-flex items-center shrink-0 opacity-50">
        <Icons.search size={ICON_SIZE.LG} />
      </span>
      <input
        ref={inputRef}
        className="search-input flex-1 border-none outline-none bg-transparent text-text text-4 font-sans"
        type="text"
        placeholder={t('search_placeholder', 'Search invoices, bank statements, TaxID...')}
        value={value}
        onChange={handleChange}
        onSelect={handleSelect}
        autoFocus
      />
      {value && (
        <button
          className="bg-bg-secondary border-none rounded-full w-5 h-5 text-text-secondary cursor-pointer flex items-center justify-center shrink-0 hover:bg-bg-hover"
          onClick={() => onChange('')}
          aria-label={t('clear_search_hint', 'Clear (⌘K)')}
          title={t('clear_search_hint', 'Clear (⌘K)')}
        >
          <Icons.close size={ICON_SIZE.SM} />
        </button>
      )}
      {onStatusDotClick ? (
        <button
          className={`inline-flex items-center shrink-0 border-none bg-transparent p-0 outline-none cursor-pointer hover:scale-[1.2] transition-transform ${statusConfig.className}`}
          title={`${statusConfig.label} (⌘P)`}
          aria-label={`${t('status_label', 'Status: ')}${statusConfig.label} (⌘P)`}
          onClick={onStatusDotClick}
        >
          <statusConfig.icon size={ICON_SIZE.SM} />
        </button>
      ) : (
        <span
          className={`inline-flex items-center shrink-0 ${statusConfig.className}`}
          title={statusConfig.label}
          aria-label={`${t('status_label', 'Status: ')}${statusConfig.label}`}
        >
          <statusConfig.icon size={ICON_SIZE.SM} />
        </span>
      )}
    </div>
  );
};
