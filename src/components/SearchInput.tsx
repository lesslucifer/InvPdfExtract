import React, { useEffect, useRef } from 'react';
import { Icons, ICON_SIZE } from '../shared/icons';
import { useProcessingStore } from '../stores';
import type { LucideIcon } from 'lucide-react';

const PROCESSING_STATUS_CONFIG: Record<string, { icon: LucideIcon; className: string; label: string }> = {
  idle:       { icon: Icons.success,   className: 'text-text-muted',               label: 'All good — view processing log' },
  processing: { icon: Icons.loader,   className: 'text-accent animate-spin-slow', label: 'Processing...' },
  review:     { icon: Icons.conflict,  className: 'text-confidence-medium',        label: 'Needs review' },
  error:      { icon: Icons.error,     className: 'text-confidence-low',           label: 'Error' },
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

  const statusConfig = PROCESSING_STATUS_CONFIG[status] ?? PROCESSING_STATUS_CONFIG['idle'];

  return (
    <div className="flex items-center px-4 py-3 border-b border-border gap-2.5">
      <span className="inline-flex items-center shrink-0 opacity-50">
        <Icons.search size={ICON_SIZE.LG} />
      </span>
      <input
        ref={inputRef}
        className="search-input flex-1 border-none outline-none bg-transparent text-text text-4 font-sans"
        type="text"
        placeholder="Search invoices, bank statements, TaxID..."
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
          className={`inline-flex items-center shrink-0 border-none bg-transparent p-0 outline-none cursor-pointer hover:scale-[1.2] transition-transform ${statusConfig.className}`}
          title={statusConfig.label}
          aria-label={`Status: ${statusConfig.label}`}
          onClick={onStatusDotClick}
        >
          <statusConfig.icon size={ICON_SIZE.SM} />
        </button>
      ) : (
        <span
          className={`inline-flex items-center shrink-0 ${statusConfig.className}`}
          title={statusConfig.label}
          aria-label={`Status: ${statusConfig.label}`}
        >
          <statusConfig.icon size={ICON_SIZE.SM} />
        </span>
      )}
    </div>
  );
};
