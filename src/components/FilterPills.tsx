import React from 'react';
import { ParsedQuery, SORT_DEFAULT_DIRECTIONS } from '../shared/parse-query';

interface Props {
  filters: ParsedQuery;
  onRemoveFilter: (key: keyof ParsedQuery) => void;
}

const DOC_TYPE_PILLS: Record<string, { icon: string; label: string }> = {
  bank_statement: { icon: '🏦', label: 'Bank Statement' },
  invoice_out: { icon: '📤', label: 'Invoice Out' },
  invoice_in: { icon: '📥', label: 'Invoice In' },
};

function formatAmount(n: number): string {
  if (n >= 1_000_000_000 && n % 1_000_000_000 === 0) {
    return `${n / 1_000_000_000}t`;
  }
  if (n >= 1_000_000 && n % 1_000_000 === 0) {
    return `${n / 1_000_000}tr`;
  }
  if (n >= 1_000 && n % 1_000 === 0) {
    return `${n / 1_000}k`;
  }
  return new Intl.NumberFormat('vi-VN').format(n);
}

interface PillDef {
  key: keyof ParsedQuery;
  icon: string;
  label: string;
}

function getPills(filters: ParsedQuery): PillDef[] {
  const pills: PillDef[] = [];

  if (filters.docType) {
    const meta = DOC_TYPE_PILLS[filters.docType];
    if (meta) {
      pills.push({ key: 'docType', icon: meta.icon, label: meta.label });
    }
  }

  if (filters.status) {
    const statusIcons: Record<string, string> = { conflict: '⚠️', review: '🔍' };
    const icon = statusIcons[filters.status] || '🔖';
    const label = filters.status.charAt(0).toUpperCase() + filters.status.slice(1);
    pills.push({ key: 'status', icon, label });
  }

  if (filters.amountMin != null && filters.amountMax != null) {
    pills.push({
      key: 'amountMin',
      icon: '💰',
      label: `${formatAmount(filters.amountMin)}–${formatAmount(filters.amountMax)}`,
    });
  } else if (filters.amountMin != null) {
    pills.push({ key: 'amountMin', icon: '💰', label: `>${formatAmount(filters.amountMin)}` });
  } else if (filters.amountMax != null) {
    pills.push({ key: 'amountMax', icon: '💰', label: `<${formatAmount(filters.amountMax)}` });
  }

  if (filters.dateFilter) {
    pills.push({ key: 'dateFilter', icon: '📅', label: filters.dateFilter });
  }

  if (filters.sortField) {
    const isDefault = filters.sortField === 'time' &&
      (!filters.sortDirection || filters.sortDirection === 'desc');
    if (!isDefault) {
      const sortLabels: Record<string, string> = {
        time: 'Processed', date: 'Date', path: 'Path', amount: 'Amount', confidence: 'Confidence',
      };
      const dir = filters.sortDirection || SORT_DEFAULT_DIRECTIONS[filters.sortField];
      const arrow = dir === 'asc' ? '\u2191' : '\u2193';
      pills.push({
        key: 'sortField',
        icon: arrow,
        label: `Sort: ${sortLabels[filters.sortField] || filters.sortField}`,
      });
    }
  }

  return pills;
}

export const FilterPills: React.FC<Props> = ({ filters, onRemoveFilter }) => {
  const pills = getPills(filters);
  if (pills.length === 0) return null;

  return (
    <div className="filter-pills">
      {pills.map((pill) => (
        <span key={pill.key} className="filter-pill">
          <span className="filter-pill-icon">{pill.icon}</span>
          <span className="filter-pill-label">{pill.label}</span>
          <button
            className="filter-pill-close"
            onClick={() => onRemoveFilter(pill.key)}
            aria-label={`Remove ${pill.label} filter`}
          >
            &times;
          </button>
        </span>
      ))}
    </div>
  );
};

// Export for testing
export { getPills, formatAmount };
