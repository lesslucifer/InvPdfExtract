import { t } from '../lib/i18n';
import React, { useState } from 'react';
import { formatCurrency } from '../shared/format';

interface Props {
  suggestedValue: number;
  label: string;
  onApply: (value: string) => void;
}

export const QuickFixButton: React.FC<Props> = ({ suggestedValue, label, onApply }) => {
  const [state, setState] = useState<'idle' | 'confirming'>('idle');

  if (state === 'idle') {
    return (
      <button
        className="text-confidence-low text-2.5 font-bold cursor-pointer bg-transparent border-none px-0.5 leading-none hover:opacity-70"
        title={`${label}: ${formatCurrency(suggestedValue)}`}
        onClick={(e) => { e.stopPropagation(); setState('confirming'); }}
      >
        !
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-2.75" onClick={(e) => e.stopPropagation()}>
      <span className="text-text-secondary">{label}: {formatCurrency(suggestedValue)}</span>
      <button
        className="bg-accent text-white border-none rounded px-1.5 py-[1px] text-2.5 font-medium cursor-pointer hover:opacity-85"
        onClick={() => { onApply(String(suggestedValue)); setState('idle'); }}
      >{t('apply', 'Apply')}</button>
      <button
        className="bg-bg-hover text-text-secondary border-none rounded px-1.5 py-[1px] text-2.5 font-medium cursor-pointer hover:bg-border"
        onClick={() => setState('idle')}
      >{t('cancel', 'Cancel')}</button>
    </span>
  );
};
