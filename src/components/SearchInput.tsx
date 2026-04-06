import React, { useEffect, useRef } from 'react';
import { Icons, ICON_SIZE } from '../shared/icons';
import { useProcessingStore } from '../stores';

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

  return (
    <div className="search-input-container">
      <span className="search-icon"><Icons.search size={ICON_SIZE.LG} /></span>
      <input
        ref={inputRef}
        className="search-input"
        type="text"
        placeholder="Search invoices, bank statements, MST..."
        value={value}
        onChange={handleChange}
        onSelect={handleSelect}
        autoFocus
      />
      {value && (
        <button className="search-clear" onClick={() => onChange('')} aria-label="Clear">
          <Icons.close size={ICON_SIZE.SM} />
        </button>
      )}
      {onStatusDotClick ? (
        <button
          className={`status-dot status-dot--${status} status-dot--clickable`}
          title={status === 'idle' ? 'Idle' : status === 'processing' ? 'Processing...' : status === 'review' ? 'Needs review' : 'Error'}
          aria-label={`Status: ${status}`}
          onClick={onStatusDotClick}
        />
      ) : (
        <span
          className={`status-dot status-dot--${status}`}
          title={status === 'idle' ? 'Idle' : status === 'processing' ? 'Processing...' : status === 'review' ? 'Needs review' : 'Error'}
          aria-label={`Status: ${status}`}
        />
      )}
    </div>
  );
};
