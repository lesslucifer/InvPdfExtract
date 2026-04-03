import React, { useState, useCallback } from 'react';
import { SearchResult, DocType } from '../shared/types';

interface Props {
  result: SearchResult;
  isSelected: boolean;
  isExpanded: boolean;
  onClick: () => void;
  onFolderClick?: (folder: string) => void;
  onDocTypeClick?: (docType: string) => void;
  onOpenFile?: (relativePath: string) => void;
  onReprocessFile?: (relativePath: string) => void;
  onReprocessFolder?: (folderPrefix: string) => void;
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

interface PathSegment {
  label: string;
  folder: string;
}

function splitPath(relativePath: string): { segments: PathSegment[]; filename: string } {
  const parts = relativePath.split('/');
  const filename = parts.pop() || '';
  const segments: PathSegment[] = parts.map((label, i) => ({
    label,
    folder: parts.slice(0, i + 1).join('/'),
  }));
  return { segments, filename };
}

export const ResultRow: React.FC<Props> = ({ result, isSelected, isExpanded, onClick, onFolderClick, onDocTypeClick, onOpenFile, onReprocessFile, onReprocessFolder }) => {
  const [confirmFolder, setConfirmFolder] = useState<string | null>(null);
  const meta = DOC_TYPE_LABELS[result.doc_type] || DOC_TYPE_LABELS[DocType.Unknown];
  const isBank = result.doc_type === DocType.BankStatement;

  const primaryLabel = isBank
    ? result.ten_ngan_hang || 'Bank Statement'
    : result.so_hoa_don || 'Invoice';

  const amount = isBank ? result.so_tien : result.tong_tien;
  const counterparty = result.ten_doi_tac;

  const { segments, filename } = splitPath(result.relative_path);

  const handleReprocessFile = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onReprocessFile?.(result.relative_path);
  }, [onReprocessFile, result.relative_path]);

  const handleReprocessFolder = useCallback(async (e: React.MouseEvent, folder: string) => {
    e.stopPropagation();
    if (!onReprocessFolder) return;
    try {
      const { count } = await window.api.countFolderFiles(folder);
      if (count > 10) {
        setConfirmFolder(folder);
      } else {
        onReprocessFolder(folder);
      }
    } catch {
      onReprocessFolder(folder);
    }
  }, [onReprocessFolder]);

  const handleConfirmReprocess = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmFolder && onReprocessFolder) {
      onReprocessFolder(confirmFolder);
    }
    setConfirmFolder(null);
  }, [confirmFolder, onReprocessFolder]);

  const handleCancelReprocess = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmFolder(null);
  }, []);

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
        {segments.map((seg) => (
          <span key={seg.folder} className="result-file-segment-group">
            <span
              className={onFolderClick ? 'result-file-segment' : undefined}
              onClick={onFolderClick ? (e) => { e.stopPropagation(); onFolderClick(seg.folder); } : undefined}
            >
              {seg.label}/
            </span>
            {onReprocessFolder && (
              <button
                className="result-reload-btn"
                title={`Reprocess all files in ${seg.folder}`}
                onClick={(e) => handleReprocessFolder(e, seg.folder)}
              >↻</button>
            )}
          </span>
        ))}
        {onOpenFile ? (
          <span
            className="result-file-link"
            onClick={(e) => { e.stopPropagation(); onOpenFile(result.relative_path); }}
          >
            {filename}
          </span>
        ) : (
          <span>{filename}</span>
        )}
        {onReprocessFile && (
          <button
            className="result-reload-btn"
            title="Reprocess this file"
            onClick={handleReprocessFile}
          >↻</button>
        )}
      </div>
      {confirmFolder && (
        <div className="result-confirm-bar" onClick={(e) => e.stopPropagation()}>
          <span>Reprocess all files in <strong>{confirmFolder}</strong>?</span>
          <button className="result-confirm-yes" onClick={handleConfirmReprocess}>Yes</button>
          <button className="result-confirm-no" onClick={handleCancelReprocess}>Cancel</button>
        </div>
      )}
    </div>
  );
};

// Export for testing
export { splitPath };
