import React from 'react';
import { SearchResult, DocType } from '../shared/types';

interface Props {
  result: SearchResult;
  isSelected: boolean;
  isExpanded: boolean;
  onClick: () => void;
}

const DOC_TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  [DocType.BankStatement]: { label: 'Bank', icon: '🏦' },
  [DocType.InvoiceOut]: { label: 'Out', icon: '📤' },
  [DocType.InvoiceIn]: { label: 'In', icon: '📥' },
  [DocType.Unknown]: { label: '?', icon: '📄' },
};

function formatAmount(amount: number): string {
  if (!amount) return '';
  return new Intl.NumberFormat('vi-VN').format(amount);
}

function confidenceClass(confidence: number): string {
  if (confidence >= 0.9) return 'confidence-high';
  if (confidence >= 0.7) return 'confidence-medium';
  return 'confidence-low';
}

export const ResultRow: React.FC<Props> = ({ result, isSelected, isExpanded, onClick }) => {
  const meta = DOC_TYPE_LABELS[result.doc_type] || DOC_TYPE_LABELS[DocType.Unknown];
  const isBank = result.doc_type === DocType.BankStatement;

  const primaryLabel = isBank
    ? result.ten_ngan_hang || 'Bank Statement'
    : result.so_hoa_don || 'Invoice';

  const amount = isBank ? result.so_tien : result.tong_tien;
  const counterparty = result.ten_doi_tac;

  return (
    <div
      className={`result-row ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}
      onClick={onClick}
      role="option"
      aria-selected={isSelected}
    >
      <div className="result-row-main">
        <span className="result-icon" title={meta.label}>{meta.icon}</span>
        <div className="result-info">
          <div className="result-primary">
            <span className="result-label">{primaryLabel}</span>
            {result.mst && <span className="result-mst">MST: {result.mst}</span>}
          </div>
          <div className="result-secondary">
            {counterparty && <span className="result-counterparty">{counterparty}</span>}
            {result.ngay && <span className="result-date">{result.ngay}</span>}
          </div>
        </div>
        <div className="result-right">
          {amount > 0 && <span className="result-amount">{formatAmount(amount)}</span>}
          <span className={`result-confidence ${confidenceClass(result.confidence)}`}>
            {Math.round(result.confidence * 100)}%
          </span>
        </div>
      </div>
      <div className="result-file" title={result.relative_path}>{result.relative_path}</div>
    </div>
  );
};
