import { t } from '../lib/i18n';
import React from 'react';
import { SearchResult, DocType } from '../shared/types';
import { StatusIcon } from './StatusIcon';
import { formatCurrency } from '../shared/format';
import { DOC_TYPE_ICONS, ICON_SIZE } from '../shared/icons';
import { useSearchStore } from '../stores';

interface Props {
  result: SearchResult;
  isSelected: boolean;
  isExpanded: boolean;
  onClick: () => void;
  onOpenFile?: (relativePath: string) => void;
  onOpenFolder?: (folder: string) => void;
  onReprocessFile?: (relativePath: string) => void;
  onReprocessFolder?: (folder: string) => void;
}

const CONFIDENCE_CLASSES: Record<'high' | 'medium' | 'low', string> = {
  high:   'text-confidence-high bg-confidence-high/10',
  medium: 'text-confidence-medium bg-confidence-medium/10',
  low:    'text-confidence-low bg-confidence-low/10',
};

function confidenceClasses(confidence: number): string {
  if (confidence >= 0.9) return CONFIDENCE_CLASSES.high;
  if (confidence >= 0.7) return CONFIDENCE_CLASSES.medium;
  return CONFIDENCE_CLASSES.low;
}

function middleEllipsis(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const dotIdx = text.lastIndexOf('.');
  if (dotIdx > 0 && text.length - dotIdx <= 6) {
    const ext = text.slice(dotIdx);
    const nameMax = maxLen - ext.length - 3;
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

export const ResultRow: React.FC<Props> = ({ result, isSelected, isExpanded, onClick, onOpenFile, onOpenFolder, onReprocessFile, onReprocessFolder }) => {
  const meta = DOC_TYPE_ICONS[result.doc_type] || DOC_TYPE_ICONS['unknown'];
  const isBank = result.doc_type === DocType.BankStatement;

  const primaryLabel = isBank
    ? result.bank_name || t('bank_statement', 'Bank Statement')
    : result.invoice_number || t('invoice', 'Invoice');

  const amount = isBank ? result.amount : result.total_amount;
  const counterparty = result.counterparty_name;

  const { folder, folderFull, filename } = splitPath(result.relative_path);

  return (
    <div
      className={`px-4 py-2 cursor-pointer border-b border-border transition-colors last:border-b-0 ${isSelected || isExpanded ? (isExpanded ? 'bg-bg-secondary' : 'bg-bg-hover') : 'hover:bg-bg-hover'}`}
      onClick={onClick}
      role="option"
      aria-selected={isSelected}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="inline-flex items-center justify-center shrink-0 w-5 text-center cursor-pointer transition-transform hover:scale-[1.2]"
          title={meta.label}
          onClick={(e) => { e.stopPropagation(); useSearchStore.getState().applyDocTypeFilter(result.doc_type); }}
        >
          <meta.icon size={ICON_SIZE.LG} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold whitespace-nowrap overflow-hidden text-ellipsis">{primaryLabel}</span>
            {result.tax_id && (
              <span
                className="text-2.75 text-text-secondary whitespace-nowrap cursor-pointer rounded-sm px-[3px] hover:bg-[rgba(255,255,255,0.08)] hover:text-accent hover:underline"
                title={t('ctrl_click_filter_taxid', 'Ctrl+Click to filter by this TaxID')}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    e.stopPropagation();
                    useSearchStore.getState().applyMstFilter(result.tax_id);
                  }
                }}
              >{`${t('taxId', 'TaxID')}: `}{result.tax_id}</span>
            )}
          </div>
          <div className="flex gap-3 mt-0.5 text-3 text-text-secondary">
            {counterparty && <span className="overflow-hidden text-ellipsis whitespace-nowrap">{counterparty}</span>}
            {result.doc_date && (
              <span
                className="cursor-pointer rounded-sm px-[3px] hover:bg-[rgba(255,255,255,0.08)] hover:text-accent hover:underline"
                title={t('cmd_click_filter_date_alt_click_month', '⌘+Click: filter by date · ⌥+Click: filter by month')}
                onClick={(e) => {
                  if (e.altKey) {
                    e.stopPropagation();
                    useSearchStore.getState().applyDateFilter(result.doc_date?.slice(0, 7) || '');
                  } else if (e.ctrlKey || e.metaKey) {
                    e.stopPropagation();
                    useSearchStore.getState().applyDateFilter(result.doc_date || '');
                  }
                }}
              >{result.doc_date}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          {amount > 0 && (
            <span className="font-semibold tabular-nums text-3.25">
              {formatCurrency(amount)}
              {!isBank && result.line_item_sum != null && result.total_amount > 0 && Math.abs(result.line_item_sum - result.total_amount) > 1000 && (
                <span className="text-confidence-low text-2.75 font-bold ml-[3px]" title={`${t('sum_of_items', 'Sum of items')}: ${formatCurrency(result.line_item_sum)}`}>!</span>
              )}
            </span>
          )}
          <span className={`text-2.75 font-medium px-1.5 py-[1px] rounded ${confidenceClasses(result.confidence)}`}>
            {Math.round(result.confidence * 100)}%
          </span>
        </div>
      </div>
      <div className="mt-1 text-2.75 text-text-muted whitespace-nowrap overflow-hidden text-ellipsis" title={result.relative_path}>
        {folder && (
          <span
            className="text-text-muted mr-[1px] cursor-pointer rounded-sm px-[1px] hover:text-accent hover:underline"
            title={folderFull}
            onClick={(e) => {
              e.stopPropagation();
              if ((e.metaKey || e.ctrlKey) && onOpenFolder) {
                onOpenFolder(folderFull);
              } else if (e.altKey && onReprocessFolder) {
                onReprocessFolder(folderFull);
              } else {
                useSearchStore.getState().browseFolder(folderFull);
              }
            }}
          >
            {middleEllipsis(folder, FOLDER_MAX_LEN)}/
          </span>
        )}
        {result.file_status && <StatusIcon status={result.file_status} />}
        <span
          className="text-text-secondary cursor-pointer rounded-sm px-[1px] hover:text-accent hover:underline"
          title={`${t('scope_to', 'Scope to')} ${filename}`}
          onClick={(e) => {
            e.stopPropagation();
            if ((e.metaKey || e.ctrlKey) && onOpenFile) {
              onOpenFile(result.relative_path);
            } else if (e.altKey && onReprocessFile) {
              onReprocessFile(result.relative_path);
            } else {
              useSearchStore.getState().browseFile(result.relative_path);
            }
          }}
        >
          {middleEllipsis(filename, FILENAME_MAX_LEN)}
        </span>
      </div>
    </div>
  );
};

// Export for testing
export { splitPath, middleEllipsis };
