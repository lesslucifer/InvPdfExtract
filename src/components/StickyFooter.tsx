import React, { useState, useCallback } from 'react';
import { AggregateStats, SearchFilters } from '../shared/types';

interface Props {
  stats: AggregateStats;
  filters: SearchFilters;
  onWindowlize?: () => void;
  onGearClick?: () => void;
}

export function formatVND(amount: number): string {
  if (amount === 0) return '0';
  return new Intl.NumberFormat('vi-VN').format(amount);
}

export const StickyFooter: React.FC<Props> = ({ stats, filters, onWindowlize, onGearClick }) => {
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

  if (stats.totalRecords === 0 && !onGearClick) return null;

  return (
    <div className="sticky-footer">
      {stats.totalRecords > 0 ? (
        <div className="sticky-footer-stats">
          <span className="sticky-footer-count">{stats.totalRecords} records</span>
          {stats.totalAmount > 0 && (
            <>
              <span className="sticky-footer-separator" />
              <span className="sticky-footer-amount">{formatVND(stats.totalAmount)}</span>
            </>
          )}
        </div>
      ) : (
        <div className="sticky-footer-stats" />
      )}
      <div className="sticky-footer-actions">
        {stats.totalRecords > 0 && (toast ? (
          <div className="sticky-footer-toast">
            <span>{toast.message}</span>
            <button className="sticky-footer-toast-open" onClick={handleOpenExportFile}>Open</button>
          </div>
        ) : (
          <button
            className="sticky-footer-export"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? 'Exporting...' : 'Export XLSX'}
          </button>
        ))}
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
        {onGearClick && (
          <button
            className="footer-gear-btn"
            onClick={onGearClick}
            aria-label="Settings"
            title="Settings"
          >
            &#x2699;
          </button>
        )}
      </div>
    </div>
  );
};
