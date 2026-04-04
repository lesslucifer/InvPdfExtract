import React, { useEffect, useRef, useState, useCallback } from 'react';

type StatusIndicator = 'idle' | 'processing' | 'review' | 'error';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (pos: number) => void;
  onStatusDotClick?: () => void;
  status?: StatusIndicator;
  hasActiveFilters?: boolean;
  onSavePreset?: (name: string) => void;
}

export const SearchInput: React.FC<Props> = ({ value, onChange, onCursorChange, onStatusDotClick, status = 'idle', hasActiveFilters, onSavePreset }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [savingName, setSavingName] = useState<string | null>(null);

  useEffect(() => {
    if (savingName === null) {
      inputRef.current?.focus();
    }
  }, [savingName]);

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

  const handleStartSave = useCallback(() => {
    setSavingName('');
  }, []);

  const handleSaveKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && savingName && savingName.trim()) {
      onSavePreset?.(savingName.trim());
      setSavingName(null);
    } else if (e.key === 'Escape') {
      setSavingName(null);
    }
  }, [savingName, onSavePreset]);

  // Saving mode: show name input instead of search input
  if (savingName !== null) {
    return (
      <div className="search-input-container">
        <span className="search-icon preset-save-icon">&#x2605;</span>
        <input
          className="search-input"
          type="text"
          placeholder="Preset name..."
          value={savingName}
          onChange={(e) => setSavingName(e.target.value)}
          onKeyDown={handleSaveKeyDown}
          autoFocus
        />
        <button className="search-clear" onClick={() => setSavingName(null)} aria-label="Cancel">
          &times;
        </button>
      </div>
    );
  }

  return (
    <div className="search-input-container">
      <span className="search-icon">&#x1F50D;</span>
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
          &times;
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
      {hasActiveFilters && onSavePreset && (
        <button className="preset-save-btn" onClick={handleStartSave} aria-label="Save filter preset" title="Save filter preset">
          &#x2606;
        </button>
      )}
    </div>
  );
};
