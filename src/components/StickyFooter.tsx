import React, { useState, useCallback, useEffect } from 'react';
import { AggregateStats, SearchFilters } from '../shared/types';

interface Props {
  stats: AggregateStats;
  filters: SearchFilters;
  onWindowlize?: () => void;
}

export function formatVND(amount: number): string {
  if (amount === 0) return '0';
  return new Intl.NumberFormat('vi-VN').format(amount);
}

export const StickyFooter: React.FC<Props> = ({ stats, filters, onWindowlize }) => {
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ message: string; filePath: string } | null>(null);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await window.api.exportFiltered(filters);
      if (result.filePath) {
        setToast({ message: `Exported ${stats.totalRecords} records`, filePath: result.filePath });
        setTimeout(() => setToast(null), 5000);
      }
    } finally {
      setExporting(false);
    }
  }, [filters, stats.totalRecords]);

  const handleOpenExportFile = useCallback(() => {
    if (toast) {
      window.api.showItemInFolder(toast.filePath);
    }
  }, [toast]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (!exporting && stats.totalRecords > 0 && !toast) {
          handleExport();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [exporting, stats.totalRecords, toast, handleExport]);

  if (stats.totalRecords === 0) return null;

  return (
    <div className="sticky-footer">
      <div className="sticky-footer-stats">
        <span className="sticky-footer-count">{stats.totalRecords} records</span>
        {stats.totalAmount > 0 && (
          <>
            <span className="sticky-footer-separator" />
            <span className="sticky-footer-amount">{formatVND(stats.totalAmount)}</span>
          </>
        )}
      </div>
      <div className="sticky-footer-actions">
        {toast ? (
          <div className="sticky-footer-toast">
            <span>{toast.message}</span>
            <button className="sticky-footer-toast-open" onClick={handleOpenExportFile}>Open</button>
          </div>
        ) : (
          <button
            className="sticky-footer-export"
            onClick={handleExport}
            disabled={exporting}
            aria-label="Export XLSX"
            title="Export XLSX (⌘S)"
          >
            {exporting ? (
              'Exporting...'
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
                <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z" />
              </svg>
            )}
          </button>
        )}
        {onWindowlize && (
          <button
            className="windowlize-btn"
            onClick={onWindowlize}
            aria-label="Open as window"
            title="Open as window"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2.5 1A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 1h-11zM2 2.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5V4H2V2.5zM2 5h12v8.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V5z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};
