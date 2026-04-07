import React from 'react';
import { t } from '../lib/i18n';
import { ParsedQuery, SORT_DEFAULT_DIRECTIONS } from '../shared/parse-query';
import { formatCurrency } from '../shared/format';
import { Icons, DOC_TYPE_ICONS, ICON_SIZE, type IconName } from '../shared/icons';
import { Icon } from './Icon';
import { useSearchStore } from '../stores';

function formatAmount(n: number): string {
  return formatCurrency(n, { abbreviated: true });
}

interface PillDef {
  key: keyof ParsedQuery;
  icon: IconName;
  label: string;
}

function getPills(filters: ParsedQuery): PillDef[] {
  const pills: PillDef[] = [];

  if (filters.docType) {
    const meta = DOC_TYPE_ICONS[filters.docType];
    if (meta) {
      const docTypeIconMap: Record<string, IconName> = {
        bank_statement: 'bankStatement',
        invoice_out: 'invoiceOut',
        invoice_in: 'invoiceIn',
        invoice: 'invoiceAny',
      };
      const iconName = docTypeIconMap[filters.docType] ?? 'file';
      pills.push({ key: 'docType', icon: iconName, label: meta.label });
    }
  }

  if (filters.status) {
    const statusIcons: Record<string, IconName> = { conflict: 'conflict', review: 'eye', mismatch: 'mismatch' };
    const icon = statusIcons[filters.status] || 'zap';
    const label = filters.status.charAt(0).toUpperCase() + filters.status.slice(1);
    pills.push({ key: 'status', icon, label });
  }

  if (filters.taxId) {
    pills.push({ key: 'taxId', icon: 'fingerprint', label: `TaxID: ${filters.taxId}` });
  }

  if (filters.amountMin != null && filters.amountMax != null) {
    pills.push({
      key: 'amountMin',
      icon: 'amount',
      label: `${formatAmount(filters.amountMin)}–${formatAmount(filters.amountMax)}`,
    });
  } else if (filters.amountMin != null) {
    pills.push({ key: 'amountMin', icon: 'amount', label: `>${formatAmount(filters.amountMin)}` });
  } else if (filters.amountMax != null) {
    pills.push({ key: 'amountMax', icon: 'amount', label: `<${formatAmount(filters.amountMax)}` });
  }

  if (filters.dateFilter) {
    pills.push({ key: 'dateFilter', icon: 'calendar', label: filters.dateFilter });
  }

  if (filters.sortField) {
    const isDefault = filters.sortField === 'time' &&
      (!filters.sortDirection || filters.sortDirection === 'desc');
    if (!isDefault) {
      const sortLabels: Record<string, string> = {
        time: t('processed', 'Processed'), date: t('date', 'Date'), path: t('path', 'Path'), amount: t('amount', 'Amount'), confidence: t('confidence', 'Confidence'), shd: t('invoice_#', 'Invoice #'),
      };
      const dir = filters.sortDirection || SORT_DEFAULT_DIRECTIONS[filters.sortField];
      const icon: IconName = dir === 'asc' ? 'arrowUp' : 'arrowDown';
      pills.push({
        key: 'sortField',
        icon,
        label: `Sort: ${sortLabels[filters.sortField] || filters.sortField}`,
      });
    }
  }

  return pills;
}

export const FilterPills: React.FC = () => {
  const filters = useSearchStore(s => s.filters);
  const removeFilter = useSearchStore(s => s.removeFilter);
  const toggleSortDirection = useSearchStore(s => s.toggleSortDirection);
  const pills = getPills(filters);
  if (pills.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-4 py-1.5 border-b border-border">
      {pills.map((pill) => (
        <span key={pill.key} className="inline-flex items-center gap-1 bg-bg-secondary border border-border rounded-full px-2.5 py-[3px] text-3 text-text">
          {pill.key === 'sortField' ? (
            <button
              className="inline-flex items-center text-text-secondary border-none bg-transparent cursor-pointer p-0.5 rounded hover:text-accent hover:bg-bg-hover transition-colors"
              onClick={toggleSortDirection}
              aria-label="Toggle sort direction"
              title="Toggle sort direction"
            >
              <Icon name={pill.icon} size={ICON_SIZE.SM} />
            </button>
          ) : (
            <span className="inline-flex items-center"><Icon name={pill.icon} size={ICON_SIZE.SM} /></span>
          )}
          <span className="whitespace-nowrap">{pill.label}</span>
          <button
            className="bg-transparent border-none text-text-muted cursor-pointer px-0.5 inline-flex items-center rounded-full hover:text-text hover:bg-bg-hover"
            onClick={() => removeFilter(pill.key)}
            aria-label={`Remove ${pill.label} filter`}
          >
            <Icons.close size={ICON_SIZE.XS} />
          </button>
        </span>
      ))}
    </div>
  );
};

// Export for testing
export { getPills, formatAmount };
