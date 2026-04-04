import React, { useState } from 'react';

interface Props {
  suggestedValue: number;
  label: string;
  onApply: (value: string) => void;
}

function formatAmount(amount: number): string {
  if (!amount) return '0';
  return new Intl.NumberFormat('vi-VN').format(amount);
}

export const QuickFixButton: React.FC<Props> = ({ suggestedValue, label, onApply }) => {
  const [state, setState] = useState<'idle' | 'confirming'>('idle');

  if (state === 'idle') {
    return (
      <button
        className="quickfix-trigger"
        title={`${label}: ${formatAmount(suggestedValue)}`}
        onClick={(e) => { e.stopPropagation(); setState('confirming'); }}
      >
        !
      </button>
    );
  }

  return (
    <span className="quickfix-confirm" onClick={(e) => e.stopPropagation()}>
      <span className="quickfix-label">{label}: {formatAmount(suggestedValue)}</span>
      <button
        className="quickfix-btn quickfix-apply"
        onClick={() => { onApply(String(suggestedValue)); setState('idle'); }}
      >
        Apply
      </button>
      <button
        className="quickfix-btn quickfix-cancel"
        onClick={() => setState('idle')}
      >
        Cancel
      </button>
    </span>
  );
};
