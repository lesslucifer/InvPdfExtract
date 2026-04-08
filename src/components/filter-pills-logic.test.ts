import { describe, it, expect } from 'vitest';
import { ParsedQuery } from '../shared/parse-query';
import { formatCurrency } from '../shared/format';
import { DOC_TYPE_ICONS } from '../shared/icons';
import type { IconName } from '../shared/icons';

/**
 * Tests for FilterPills logic — extracted as pure functions since
 * React components can't render in the node test environment.
 */

// === Extracted from FilterPills.tsx ===

interface PillDef {
  key: keyof ParsedQuery;
  icon: IconName;
  label: string;
}

function formatAmount(n: number): string {
  return formatCurrency(n, { abbreviated: true });
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
    const statusIcons: Record<string, IconName> = { uncertain: 'eye', mismatch: 'mismatch', ok: 'success' };
    const icon = statusIcons[filters.status] || 'zap';
    pills.push({ key: 'status', icon, label: filters.status.charAt(0).toUpperCase() + filters.status.slice(1) });
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

  if (filters.invoiceCode) {
    pills.push({ key: 'invoiceCode', icon: 'file', label: `Code: ${filters.invoiceCode}` });
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
      expect(pills[0]).toEqual({ key: 'docType', icon: 'bankStatement', label: 'Bank Statement' });
    });

    it('returns doc type pill for invoice_out', () => {
      const pills = getPills({ text: '', docType: 'invoice_out' });
      expect(pills[0].label).toBe('Invoice Out');
    });

    it('returns doc type pill for invoice_in', () => {
      const pills = getPills({ text: '', docType: 'invoice_in' });
      expect(pills[0].label).toBe('Invoice In');
    });

    it('returns status pill for uncertain', () => {
      const pills = getPills({ text: '', status: 'uncertain' });
      expect(pills).toHaveLength(1);
      expect(pills[0]).toEqual({ key: 'status', icon: 'eye', label: 'Uncertain' });
    });

    it('returns status pill for ok', () => {
      const pills = getPills({ text: '', status: 'ok' });
      expect(pills[0]).toEqual({ key: 'status', icon: 'success', label: 'Ok' });
    });

    it('returns status pill for mismatch', () => {
      const pills = getPills({ text: '', status: 'mismatch' });
      expect(pills[0]).toEqual({ key: 'status', icon: 'mismatch', label: 'Mismatch' });
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
      expect(pills[0]).toEqual({ key: 'dateFilter', icon: 'calendar', label: '2024-03' });
    });

    it('returns invoice code pill', () => {
      const pills = getPills({ text: '', invoiceCode: 'C26TAA' });
      expect(pills).toHaveLength(1);
      expect(pills[0]).toEqual({ key: 'invoiceCode', icon: 'file', label: 'Code: C26TAA' });
    });

    it('returns multiple pills for combined filters', () => {
      const pills = getPills({
        text: 'hello',
        docType: 'bank_statement',
        status: 'uncertain',
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
    it('formats thousands as k', () => {
      expect(formatAmount(100_000)).toBe('100k');
      expect(formatAmount(5_000)).toBe('5k');
    });

    it('formats millions as tr', () => {
      expect(formatAmount(5_000_000)).toBe('5tr');
      expect(formatAmount(100_000_000)).toBe('100tr');
    });

    it('formats billions as t', () => {
      expect(formatAmount(1_000_000_000)).toBe('1t');
      expect(formatAmount(100_000_000_000)).toBe('100t');
    });

    it('formats non-round amounts with locale formatting', () => {
      const result = formatAmount(1234567);
      // vi-VN uses dot separator
      expect(result).toMatch(/1[.,]234[.,]567/);
    });

    it('prefers largest clean suffix', () => {
      // 2,000,000,000 is both 2000tr and 2t — should pick t
      expect(formatAmount(2_000_000_000)).toBe('2t');
      // 3,000,000 is both 3000k and 3tr — should pick tr
      expect(formatAmount(3_000_000)).toBe('3tr');
    });

    it('pill displays 100k–100t for input 100k-100b', () => {
      const pills = getPills({ text: '', amountMin: 100_000, amountMax: 100_000_000_000 });
      expect(pills[0].label).toBe('100k–100t');
    });
  });
});
