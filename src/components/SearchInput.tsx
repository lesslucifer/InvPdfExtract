import React, { useEffect, useRef } from 'react';

type StatusIndicator = 'idle' | 'processing' | 'review' | 'error';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onGearClick?: () => void;
  status?: StatusIndicator;
}

export const SearchInput: React.FC<Props> = ({ value, onChange, onGearClick, status = 'idle' }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="search-input-container">
      <span className="search-icon">&#x1F50D;</span>
      <input
        ref={inputRef}
        className="search-input"
        type="text"
        placeholder="Search invoices, bank statements, MST..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
      />
      {value && (
        <button className="search-clear" onClick={() => onChange('')} aria-label="Clear">
          &times;
        </button>
      )}
      <span
        className={`status-dot status-dot--${status}`}
        title={status === 'idle' ? 'Idle' : status === 'processing' ? 'Processing...' : status === 'review' ? 'Needs review' : 'Error'}
        aria-label={`Status: ${status}`}
      />
      {onGearClick && (
        <button className="gear-icon" onClick={onGearClick} aria-label="Settings">
          &#x2699;
        </button>
      )}
    </div>
  );
};
