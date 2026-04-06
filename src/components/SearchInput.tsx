import React, { useEffect, useRef } from 'react';
import { Icons, ICON_SIZE } from '../shared/icons';
import { useProcessingStore } from '../stores';

const PROCESSING_STATUS_CLASSES: Record<string, string> = {
  idle:       'bg-confidence-high',
  processing: 'bg-accent animate-status-pulse',
  review:     'bg-confidence-medium',
  error:      'bg-confidence-low',
};

const PROCESSING_STATUS_LABELS: Record<string, string> = {
  idle:       'Idle',
  processing: 'Processing...',
  review:     'Needs review',
  error:      'Error',
};

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (pos: number) => void;
  onStatusDotClick?: () => void;
}

export const SearchInput: React.FC<Props> = ({ value, onChange, onCursorChange, onStatusDotClick }) => {
  const status = useProcessingStore(s => s.status);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const dotClass = `w-[7px] h-[7px] rounded-full shrink-0 mr-0.5 transition-colors ${PROCESSING_STATUS_CLASSES[status] ?? 'bg-text-muted'}`;
  const dotLabel = PROCESSING_STATUS_LABELS[status] ?? status;

  return (
    <div className="flex items-center px-4 py-3 border-b border-border gap-2.5">
      <span className="inline-flex items-center shrink-0 opacity-50">
        <Icons.search size={ICON_SIZE.LG} />
      </span>
      <input
        ref={inputRef}
        className="search-input flex-1 border-none outline-none bg-transparent text-text text-4 font-sans"
        type="text"
        placeholder="Search invoices, bank statements, MST..."
        value={value}
        onChange={handleChange}
        onSelect={handleSelect}
        autoFocus
      />
      {value && (
        <button
          className="bg-bg-secondary border-none rounded-full w-5 h-5 text-text-secondary cursor-pointer flex items-center justify-center shrink-0 hover:bg-bg-hover"
          onClick={() => onChange('')}
          aria-label="Clear"
        >
          <Icons.close size={ICON_SIZE.SM} />
        </button>
      )}
      {onStatusDotClick ? (
        <button
          className={`${dotClass} border-none p-0 outline-none cursor-pointer hover:scale-[1.4]`}
          title={dotLabel}
          aria-label={`Status: ${status}`}
          onClick={onStatusDotClick}
        />
      ) : (
        <span
          className={dotClass}
          title={dotLabel}
          aria-label={`Status: ${status}`}
        />
      )}
    </div>
  );
};
