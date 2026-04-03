import React from 'react';
import { SearchResult, DocType } from '../shared/types';
import { StatusDot } from './StatusDot';

interface Props {
  result: SearchResult;
  isSelected: boolean;
  isExpanded: boolean;
  onClick: () => void;
  onFolderClick?: (folder: string) => void;
  onDocTypeClick?: (docType: string) => void;
  onOpenFile?: (relativePath: string) => void;
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

/**
 * Truncate a string in the middle, preserving start and end.
 * For filenames, keeps the extension visible.
 */
function middleEllipsis(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  // For filenames with extension, preserve the extension
  const dotIdx = text.lastIndexOf('.');
  if (dotIdx > 0 && text.length - dotIdx <= 6) {
    const ext = text.slice(dotIdx);
    const nameMax = maxLen - ext.length - 3; // 3 for '...'
    if (nameMax < 4) return text.slice(0, maxLen - 3) + '...';
    return text.slice(0, nameMax) + '...' + ext;
  }
  const half = Math.floor((maxLen - 3) / 2);
  return text.slice(0, half) + '...' + text.slice(text.length - half);
}

function splitPath(relativePath: string): { folder: string; folderFull: string; filename: string } {
  const parts = relativePath.split('/');
  const filename = parts.pop() || '';
  const folderFull = parts.join('/');
  const folder = parts.length > 0 ? parts[parts.length - 1] : '';
  return { folder, folderFull, filename };
}

const FOLDER_MAX_LEN = 30;
const FILENAME_MAX_LEN = 35;

export const ResultRow: React.FC<Props> = ({ result, isSelected, isExpanded, onClick, onFolderClick, onDocTypeClick, onOpenFile }) => {
  const meta = DOC_TYPE_LABELS[result.doc_type] || DOC_TYPE_LABELS[DocType.Unknown];
  const isBank = result.doc_type === DocType.BankStatement;

  const primaryLabel = isBank
    ? result.ten_ngan_hang || 'Bank Statement'
    : result.so_hoa_don || 'Invoice';

  const amount = isBank ? result.so_tien : result.tong_tien;
  const counterparty = result.ten_doi_tac;

  const { folder, folderFull, filename } = splitPath(result.relative_path);

  return (
    <div
      className={`result-row ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}
      onClick={onClick}
      role="option"
      aria-selected={isSelected}
    >
      <div className="result-row-main">
        <span
          className={`result-icon ${onDocTypeClick ? 'result-icon-clickable' : ''}`}
          title={meta.label}
          onClick={onDocTypeClick ? (e) => { e.stopPropagation(); onDocTypeClick(result.doc_type); } : undefined}
        >
          {meta.icon}
        </span>
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
      <div className="result-file" title={result.relative_path}>
        {folder && (
          <span
            className={`result-file-folder${onFolderClick ? ' result-file-clickable' : ''}`}
            title={folderFull}
            onClick={onFolderClick ? (e) => { e.stopPropagation(); onFolderClick(folderFull); } : undefined}
          >
            {middleEllipsis(folder, FOLDER_MAX_LEN)}/
          </span>
        )}
        {result.file_status && <StatusDot status={result.file_status} />}
        {onOpenFile ? (
          <span
            className="result-file-name result-file-clickable"
            onClick={(e) => { e.stopPropagation(); onOpenFile(result.relative_path); }}
          >
            {middleEllipsis(filename, FILENAME_MAX_LEN)}
          </span>
        ) : (
          <span className="result-file-name">{middleEllipsis(filename, FILENAME_MAX_LEN)}</span>
        )}
      </div>
    </div>
  );
};

// Export for testing
export { splitPath, middleEllipsis };
