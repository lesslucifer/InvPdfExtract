import React, { useState, useCallback, useImperativeHandle, forwardRef, useEffect } from 'react';
import { SearchFilters } from '../shared/types';
import { formatCurrency } from '../shared/format';
import { Icons, ICON_SIZE } from '../shared/icons';
import { useSearchStore } from '../stores';

export interface StickyFooterHandle {
  triggerExport: () => void;
}

interface Props {
  onWindowlize?: () => void;
  onCheatsheetClick?: () => void;
  onSettingsClick?: () => void;
}

export const StickyFooter = forwardRef<StickyFooterHandle, Props>(({ onWindowlize, onCheatsheetClick, onSettingsClick }, ref) => {
  const stats = useSearchStore(s => s.aggregates);
  const storeFilters = useSearchStore(s => s.filters);
  const query = useSearchStore(s => s.query);
  const folderScope = useSearchStore(s => s.folderScope);
  const fileScope = useSearchStore(s => s.fileScope);

  const filters: SearchFilters = {
    text: query.trim() || undefined,
    folder: folderScope || undefined,
    filePath: fileScope || undefined,
    docType: storeFilters.docType,
    status: storeFilters.status,
    mst: storeFilters.mst,
    amountMin: storeFilters.amountMin,
    amountMax: storeFilters.amountMax,
    dateFilter: storeFilters.dateFilter,
  };
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

  useImperativeHandle(ref, () => ({ triggerExport: handleExport }), [handleExport]);

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
            <span className="sticky-footer-amount">{formatCurrency(stats.totalAmount)}</span>
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
            title="Export XLSX (Ctrl+S)"
          >
            <>
              
              {exporting ? (
                'Exporting...'
              ) : <Icons.download size={ICON_SIZE.SM} />}
            </>
          </button>
        )}
        {onWindowlize && (
          <button
            className="windowlize-btn"
            onClick={onWindowlize}
            aria-label="Open as window"
            title="Open as window"
          >
            <Icons.maximize size={ICON_SIZE.SM} />
          </button>
        )}
        {onCheatsheetClick && (
          <button
            className="windowlize-btn"
            onClick={onCheatsheetClick}
            aria-label="Cheatsheet"
            title="Cheatsheet (?)"
          >
            <Icons.circleHelp size={ICON_SIZE.SM} />
          </button>
        )}
        {onSettingsClick && (
          <button
            className="windowlize-btn"
            onClick={onSettingsClick}
            aria-label="Settings"
            title="Settings"
          >
            <Icons.settings size={ICON_SIZE.SM} />
          </button>
        )}
      </div>
    </div>
  );
});
