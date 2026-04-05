import React from 'react';
import { ParsedQuery, SORT_DEFAULT_DIRECTIONS } from '../shared/parse-query';
import { formatCurrency } from '../shared/format';
import { Icons, DOC_TYPE_ICONS, ICON_SIZE, type IconName } from '../shared/icons';
import { Icon } from './Icon';

interface Props {
  filters: ParsedQuery;
  onRemoveFilter: (key: keyof ParsedQuery) => void;
  onToggleSortDirection?: () => void;
}

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
      const iconName = filters.docType === 'bank_statement' ? 'bankStatement'
        : filters.docType === 'invoice_out' ? 'invoiceOut'
        : 'invoiceIn';
      pills.push({ key: 'docType', icon: iconName as IconName, label: meta.label });
    }
  }

  if (filters.status) {
    const statusIcons: Record<string, IconName> = { conflict: 'conflict', review: 'eye' };
    const icon = statusIcons[filters.status] || 'zap';
    const label = filters.status.charAt(0).toUpperCase() + filters.status.slice(1);
    pills.push({ key: 'status', icon, label });
  }

  if (filters.mst) {
    pills.push({ key: 'mst', icon: 'fingerprint', label: `MST: ${filters.mst}` });
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
        time: 'Processed', date: 'Date', path: 'Path', amount: 'Amount', confidence: 'Confidence', shd: 'Invoice #',
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

export const FilterPills: React.FC<Props> = ({ filters, onRemoveFilter, onToggleSortDirection }) => {
  const pills = getPills(filters);
  if (pills.length === 0) return null;

  return (
    <div className="filter-pills">
      {pills.map((pill) => (
        <span key={pill.key} className="filter-pill">
          {pill.key === 'sortField' && onToggleSortDirection ? (
            <button
              className="filter-pill-direction"
              onClick={onToggleSortDirection}
              aria-label="Toggle sort direction"
              title="Toggle sort direction"
            >
              <Icon name={pill.icon} size={ICON_SIZE.SM} />
            </button>
          ) : (
            <span className="filter-pill-icon"><Icon name={pill.icon} size={ICON_SIZE.SM} /></span>
          )}
          <span className="filter-pill-label">{pill.label}</span>
          <button
            className="filter-pill-close"
            onClick={() => onRemoveFilter(pill.key)}
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
