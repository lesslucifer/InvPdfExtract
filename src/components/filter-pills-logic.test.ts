import { describe, it, expect } from 'vitest';
import { ParsedQuery } from '../shared/parse-query';

/**
 * Tests for FilterPills logic — extracted as pure functions since
 * React components can't render in the node test environment.
 */

// === Extracted from FilterPills.tsx ===

interface PillDef {
  key: keyof ParsedQuery;
  icon: string;
  label: string;
}

const DOC_TYPE_PILLS: Record<string, { icon: string; label: string }> = {
  bank_statement: { icon: '🏦', label: 'Bank Statement' },
  invoice_out: { icon: '📤', label: 'Invoice Out' },
  invoice_in: { icon: '📥', label: 'Invoice In' },
};

function formatAmount(n: number): string {
  if (n >= 1_000_000 && n % 1_000_000 === 0) {
    return `${n / 1_000_000}tr`;
  }
  return new Intl.NumberFormat('vi-VN').format(n);
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

  return pills;
}

// === Tests ===

describe('FilterPills logic', () => {
  describe('getPills', () => {
    it('returns empty array when no filters are active', () => {
      expect(getPills({ text: '' })).toEqual([]);
    });

    it('returns doc type pill for bank_statement', () => {
      const pills = getPills({ text: '', docType: 'bank_statement' });
      expect(pills).toHaveLength(1);
      expect(pills[0]).toEqual({ key: 'docType', icon: '🏦', label: 'Bank Statement' });
    });

    it('returns doc type pill for invoice_out', () => {
      const pills = getPills({ text: '', docType: 'invoice_out' });
      expect(pills[0].label).toBe('Invoice Out');
    });

    it('returns doc type pill for invoice_in', () => {
      const pills = getPills({ text: '', docType: 'invoice_in' });
      expect(pills[0].label).toBe('Invoice In');
    });

    it('returns status pill for conflict', () => {
      const pills = getPills({ text: '', status: 'conflict' });
      expect(pills).toHaveLength(1);
      expect(pills[0]).toEqual({ key: 'status', icon: '⚠️', label: 'Conflict' });
    });

    it('returns status pill for review', () => {
      const pills = getPills({ text: '', status: 'review' });
      expect(pills[0]).toEqual({ key: 'status', icon: '🔍', label: 'Review' });
    });

    it('returns amount range pill with triệu shorthand', () => {
      const pills = getPills({ text: '', amountMin: 5_000_000, amountMax: 10_000_000 });
      expect(pills).toHaveLength(1);
      expect(pills[0].label).toBe('5tr–10tr');
    });

    it('returns amountMin-only pill', () => {
      const pills = getPills({ text: '', amountMin: 1_000_000 });
      expect(pills[0].label).toBe('>1tr');
    });

    it('returns amountMax-only pill', () => {
      const pills = getPills({ text: '', amountMax: 5_000_000 });
      expect(pills[0].label).toBe('<5tr');
    });

    it('returns date filter pill', () => {
      const pills = getPills({ text: '', dateFilter: '2024-03' });
      expect(pills).toHaveLength(1);
      expect(pills[0]).toEqual({ key: 'dateFilter', icon: '📅', label: '2024-03' });
    });

    it('returns multiple pills for combined filters', () => {
      const pills = getPills({
        text: 'hello',
        docType: 'bank_statement',
        status: 'conflict',
        amountMin: 5_000_000,
        amountMax: 10_000_000,
        dateFilter: '2024-03',
      });
      expect(pills).toHaveLength(4); // docType, status, amount range, date
      expect(pills.map(p => p.key)).toEqual(['docType', 'status', 'amountMin', 'dateFilter']);
    });

    it('does not include text as a pill', () => {
      const pills = getPills({ text: 'some search term' });
      expect(pills).toHaveLength(0);
    });

    it('does not include folder as a pill', () => {
      const pills = getPills({ text: '', folder: '2024/Q1' });
      expect(pills).toHaveLength(0);
    });
  });

  describe('formatAmount', () => {
    it('formats millions as triệu', () => {
      expect(formatAmount(5_000_000)).toBe('5tr');
    });

    it('formats non-million amounts with locale formatting', () => {
      const result = formatAmount(1234567);
      // vi-VN uses dot separator
      expect(result).toMatch(/1[.,]234[.,]567/);
    });
  });
});
