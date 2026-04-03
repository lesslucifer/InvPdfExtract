import React, { useState, useCallback } from 'react';
import { AggregateStats, SearchFilters } from '../shared/types';

interface Props {
  stats: AggregateStats;
  filters: SearchFilters;
}

export function formatVND(amount: number): string {
  if (amount === 0) return '0';
  return new Intl.NumberFormat('vi-VN').format(amount);
}

export const StickyFooter: React.FC<Props> = ({ stats, filters }) => {
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
        >
          {exporting ? 'Exporting...' : 'Export XLSX'}
        </button>
      )}
    </div>
  );
};
