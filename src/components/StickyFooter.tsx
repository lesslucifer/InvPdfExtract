import { t } from '../lib/i18n';
import React, { useState, useCallback, useImperativeHandle, forwardRef, useEffect } from 'react';
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

const iconBtnClass = 'bg-transparent border border-border text-text-secondary cursor-pointer px-1.5 py-1 rounded opacity-60 transition-[opacity,background] hover:opacity-100 hover:bg-bg-hover leading-[0]';

export const StickyFooter = forwardRef<StickyFooterHandle, Props>(({ onWindowlize, onCheatsheetClick, onSettingsClick }, ref) => {
  const stats = useSearchStore(s => s.aggregates);
  const storeFilters = useSearchStore(s => s.filters);
  const query = useSearchStore(s => s.query);
  const folderScope = useSearchStore(s => s.folderScope);
  const fileScope = useSearchStore(s => s.fileScope);

  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ message: string; filePath: string } | null>(null);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const filters = {
        text: query.trim() || undefined,
        folder: folderScope || undefined,
        filePath: fileScope || undefined,
        docType: storeFilters.docType,
        status: storeFilters.status,
        taxId: storeFilters.taxId,
        amountMin: storeFilters.amountMin,
        amountMax: storeFilters.amountMax,
        dateFilter: storeFilters.dateFilter,
      };
      const result = await window.api.exportFiltered(filters);
      if (result.filePath) {
        setToast({ message: `Exported ${stats.totalRecords} records`, filePath: result.filePath });
        setTimeout(() => setToast(null), 5000);
      }
    } finally {
      setExporting(false);
    }
  }, [fileScope, folderScope, query, stats.totalRecords, storeFilters]);

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
    <div className="flex items-center justify-between px-3 py-1.5 border-t border-border h-9 box-border shrink-0">
      <div className="flex items-center gap-1 text-3 text-text-muted">
        <span className="font-medium text-text-secondary">{stats.totalRecords}{` ${t('records', 'records')}`}</span>
        {stats.totalAmount > 0 && (
          <>
            <span className="w-[1px] h-3 bg-border mx-1" />
            <span className="text-text-muted">{formatCurrency(stats.totalAmount)}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {toast ? (
          <div className="flex items-center gap-2 text-3 text-text-secondary">
            <span>{toast.message}</span>
            <button
              className="bg-transparent border border-border rounded px-2 py-[2px] text-2.75 text-accent cursor-pointer hover:bg-bg-hover"
              onClick={handleOpenExportFile}
            >{t('open', 'Open')}</button>
          </div>
        ) : (
          <button
            className="bg-accent text-white border-none rounded px-2.5 py-1 text-3 cursor-pointer font-medium transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-default"
            onClick={handleExport}
            disabled={exporting}
            aria-label="Export XLSX"
            title="Export XLSX (Ctrl+S)"
          >
            {exporting ? `${t('exporting', 'Exporting')}...` : <Icons.download size={ICON_SIZE.SM} />}
          </button>
        )}
        {onWindowlize && (
          <button className={iconBtnClass} onClick={onWindowlize} aria-label="Open as window" title="Open as window">
            <Icons.maximize size={ICON_SIZE.SM} />
          </button>
        )}
        {onCheatsheetClick && (
          <button className={iconBtnClass} onClick={onCheatsheetClick} aria-label="Cheatsheet" title="Cheatsheet (?)">
            <Icons.circleHelp size={ICON_SIZE.SM} />
          </button>
        )}
        {onSettingsClick && (
          <button className={iconBtnClass} onClick={onSettingsClick} aria-label="Settings" title="Settings">
            <Icons.settings size={ICON_SIZE.SM} />
          </button>
        )}
      </div>
    </div>
  );
});
