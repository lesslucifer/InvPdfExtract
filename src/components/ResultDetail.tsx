import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { SearchResult, DocType, InvoiceLineItem, FieldOverrideInfo, JournalEntry, JEClassificationStatus } from '../shared/types';
import { EditableField } from './EditableField';
import { EditableCell } from './EditableCell';
import { JeCell } from './JeCell';
import { formatCurrency } from '../shared/format';
import { computeTotalMismatch, computeBeforeTaxTotalMismatch, computeLineItemMismatch, computeTaxRateMismatch, computeAfterTaxMismatch, deriveFieldValue } from './quickfix-logic';
import { useProcessingStore } from '../stores';
import { useResultDetail, useLineItems } from '../lib/queries';
import { useSaveFieldOverride, useSaveJournalEntry, useSaveLineItemField } from '../lib/mutations';
import { Icons, ICON_SIZE } from '../shared/icons';
import type { LucideIcon } from 'lucide-react';

interface Props {
  result: SearchResult;
}

const JE_STATUS_ICON_CONFIG: Record<string, { icon: LucideIcon; className: string; title: string }> = {
  pending:    { icon: Icons.hourglass, className: 'text-text-muted',                title: 'Queued for classification' },
  processing: { icon: Icons.loader,    className: 'text-accent animate-spin-slow',    title: 'Classifying...' },
  done:       { icon: Icons.check,     className: 'text-confidence-high',             title: 'Classified — click to reclassify' },
  error:      { icon: Icons.error,     className: 'text-confidence-low',              title: 'Classification failed — click to retry' },
};

export const ResultDetail: React.FC<Props> = ({ result }) => {
  const [localTotals, setLocalTotals] = useState<{ tong_tien: number; tong_tien_truoc_thue: number }>({
    tong_tien: result.tong_tien,
    tong_tien_truoc_thue: result.tong_tien_truoc_thue,
  });
  const [jeStatusRaw, setJeStatusRaw] = useState<JEClassificationStatus | null>(result.je_status);
  const isBank = result.doc_type === DocType.BankStatement;
  const isInvoice = result.doc_type === DocType.InvoiceIn || result.doc_type === DocType.InvoiceOut;

  useEffect(() => {
    setLocalTotals({
      tong_tien: result.tong_tien,
      tong_tien_truoc_thue: result.tong_tien_truoc_thue,
    });
  }, [result.id, result.tong_tien, result.tong_tien_truoc_thue]);

  const { data: detailData } = useResultDetail({ id: result.id });
  const overrides: FieldOverrideInfo[] = detailData?.overrides ?? [];
  const journalEntries: JournalEntry[] = detailData?.journalEntries ?? [];

  const { data: lineItemData } = useLineItems({ id: result.id });
  const lineItems: InvoiceLineItem[] = lineItemData?.lineItems ?? [];
  const lineItemOverrides: Record<string, FieldOverrideInfo[]> = lineItemData?.lineItemOverrides ?? {};

  const saveFieldOverride = useSaveFieldOverride();
  const saveJournalEntry = useSaveJournalEntry();
  const saveLineItemField = useSaveLineItemField();

  const getOverride = (fieldName: string): FieldOverrideInfo | undefined =>
    overrides.find(o => o.field_name === fieldName);

  const handleSave = async (tableName: string, fieldName: string, userValue: string) => {
    await saveFieldOverride.mutateAsync({ recordId: result.id, tableName, fieldName, userValue });
    if (fieldName === 'tong_tien' || fieldName === 'tong_tien_truoc_thue') {
      const numVal = parseFloat(userValue) || 0;
      setLocalTotals(prev => ({ ...prev, [fieldName]: numVal }));
    }
  };

  const handleResolve = async (fieldName: string, action: 'keep' | 'accept') => {
    await window.api.resolveConflict(result.id, fieldName, action);
    useResultDetail.invalidate({ id: result.id });
  };

  const handleResolveAll = async (action: 'keep' | 'accept') => {
    await window.api.resolveAllConflicts(result.id, action);
    useResultDetail.invalidate({ id: result.id });
  };

  const handleLineItemSave = async (lineItemId: string, fieldName: string, userValue: string) => {
    await saveLineItemField.mutateAsync({ input: { lineItemId, fieldName, userValue }, recordId: result.id });
  };

  const handleLineItemResolve = async (lineItemId: string, fieldName: string, action: 'keep' | 'accept') => {
    await window.api.resolveConflict(lineItemId, fieldName, action);
    useLineItems.invalidate({ id: result.id });
  };

  const getLineItemOverride = (lineItemId: string, fieldName: string): FieldOverrideInfo | undefined =>
    lineItemOverrides[lineItemId]?.find(o => o.field_name === fieldName);

  const hasConflicts = overrides.some(o => o.status === 'conflict');

  const totalMismatch = useMemo(
    () => computeTotalMismatch(localTotals.tong_tien, lineItems),
    [localTotals.tong_tien, lineItems],
  );

  const beforeTaxTotalMismatch = useMemo(
    () => computeBeforeTaxTotalMismatch(localTotals.tong_tien_truoc_thue, lineItems),
    [localTotals.tong_tien_truoc_thue, lineItems],
  );

  const hasColumnIssues = useMemo(() => {
    const beforeTax = lineItems.some(i => deriveFieldValue('thanh_tien_truoc_thue', i) != null);
    const afterTax = lineItems.some(i => deriveFieldValue('thanh_tien', i) != null);
    return { beforeTax, afterTax };
  }, [lineItems]);

  const handleColumnFix = async (fieldName: 'thanh_tien_truoc_thue' | 'thanh_tien') => {
    for (const item of lineItems) {
      const derived = deriveFieldValue(fieldName, item);
      if (derived != null) {
        await handleLineItemSave(item.id, fieldName, String(derived));
      }
    }
  };

  const jeStatus: JEClassificationStatus | null = jeStatusRaw ?? (journalEntries.length > 0 ? 'done' : null);

  const handleReclassify = () => {
    setJeStatusRaw('pending');
    window.api.reclassifyRecord(result.id);
  };

  const lastJeUpdate = useProcessingStore(s => s.lastJeUpdate);
  useEffect(() => {
    if (!lastJeUpdate) return;
    if (lastJeUpdate.recordIds.includes(result.id)) {
      setJeStatusRaw(lastJeUpdate.status);
    }
  }, [lastJeUpdate, result.id]);

  const jeByLineItem = useMemo(() => {
    const map = new Map<string, JournalEntry>();
    for (const je of journalEntries) {
      if (je.entry_type === 'line' && je.line_item_id) {
        map.set(je.line_item_id, je);
      }
    }
    return map;
  }, [journalEntries]);

  const taxJe = useMemo(() => journalEntries.find(je => je.entry_type === 'tax') ?? null, [journalEntries]);
  const settlementJe = useMemo(() => journalEntries.find(je => je.entry_type === 'settlement') ?? null, [journalEntries]);
  const bankJe = useMemo(() => journalEntries.find(je => je.entry_type === 'bank') ?? null, [journalEntries]);

  const derivedTaxAmount = useMemo(() => {
    return lineItems
      .filter(li => li.thue_suat != null && li.thue_suat > 0)
      .reduce((sum, li) => {
        const before = li.thanh_tien_truoc_thue ?? 0;
        const after = li.thanh_tien ?? 0;
        return sum + (after - before);
      }, 0);
  }, [lineItems]);

  const handleSaveJeAccount = async (entryType: 'line' | 'tax' | 'settlement' | 'bank', lineItemId: string | null, account: string) => {
    await saveJournalEntry.mutateAsync({ recordId: result.id, lineItemId: lineItemId ?? undefined, entryType, account });
  };

  const renderJeIcon = (status: string) => {
    const config = JE_STATUS_ICON_CONFIG[status];
    if (!config) return null;
    const Icon = config.icon;
    return (
      <span
        className={`inline-flex items-center ml-1.5 align-middle cursor-pointer shrink-0 ${config.className}`}
        title={config.title}
        onClick={handleReclassify}
        role="button"
        tabIndex={0}
      >
        <Icon size={ICON_SIZE.XS} />
      </span>
    );
  };

  return (
    <div className="px-4 pb-3 pl-[50px] bg-bg-secondary border-b border-border animate-detail-in">
      {hasConflicts && (
        <div className="flex items-center gap-2 py-1.5 mb-1.5 border-b border-border text-3">
          <span className="text-confidence-medium font-semibold">Conflicts detected:</span>
          <button className="border-none rounded px-2 py-[2px] text-2.75 font-medium cursor-pointer bg-bg-hover text-text hover:bg-border" onClick={() => handleResolveAll('keep')}>Keep all mine</button>
          <button className="border-none rounded px-2 py-[2px] text-2.75 font-medium cursor-pointer bg-accent text-white hover:opacity-85" onClick={() => handleResolveAll('accept')}>Accept all AI</button>
        </div>
      )}

      {isBank && (
        <table className="w-full border-collapse">
          <tbody>
            <EditableField label="Bank" value={result.ten_ngan_hang || ''} fieldName="ten_ngan_hang" tableName="bank_statement_data" recordId={result.id} override={getOverride('ten_ngan_hang')} onSave={(v) => handleSave('bank_statement_data', 'ten_ngan_hang', v)} onResolve={(a) => handleResolve('ten_ngan_hang', a)} />
            <EditableField label="Account" value={result.stk || ''} fieldName="stk" tableName="bank_statement_data" recordId={result.id} override={getOverride('stk')} onSave={(v) => handleSave('bank_statement_data', 'stk', v)} onResolve={(a) => handleResolve('stk', a)} />
            <EditableField label="Amount" value={String(result.so_tien || '')} fieldName="so_tien" tableName="bank_statement_data" recordId={result.id} override={getOverride('so_tien')} inputType="number" onSave={(v) => handleSave('bank_statement_data', 'so_tien', v)} onResolve={(a) => handleResolve('so_tien', a)} />
            <EditableField label="Counterparty" value={result.ten_doi_tac || ''} fieldName="ten_doi_tac" tableName="bank_statement_data" recordId={result.id} override={getOverride('ten_doi_tac')} onSave={(v) => handleSave('bank_statement_data', 'ten_doi_tac', v)} onResolve={(a) => handleResolve('ten_doi_tac', a)} />
            <EditableField label="Description" value={result.mo_ta || ''} fieldName="mo_ta" tableName="bank_statement_data" recordId={result.id} override={getOverride('mo_ta')} onSave={(v) => handleSave('bank_statement_data', 'mo_ta', v)} onResolve={(a) => handleResolve('mo_ta', a)} />
            <tr><td className="py-[3px] pr-2 text-3 text-text-secondary font-medium whitespace-nowrap w-[100px] align-top">Date</td><td className="py-[3px] text-3 align-top">{result.ngay || '-'}</td></tr>
            <tr>
              <td className="py-[3px] pr-2 text-3 text-text-secondary font-medium whitespace-nowrap w-[100px] align-top">
                TK
                {jeStatus && renderJeIcon(jeStatus)}
              </td>
              <JeCell account={bankJe?.account ?? null} onSave={(account) => handleSaveJeAccount('bank', null, account)} />
            </tr>
          </tbody>
        </table>
      )}

      {isInvoice && (
        <>
          <table className="w-full border-collapse">
            <tbody>
              <EditableField label="Invoice #" value={result.so_hoa_don || ''} fieldName="so_hoa_don" tableName="invoice_data" recordId={result.id} override={getOverride('so_hoa_don')} onSave={(v) => handleSave('invoice_data', 'so_hoa_don', v)} onResolve={(a) => handleResolve('so_hoa_don', a)} />
              <EditableField label="MST" value={result.mst || ''} fieldName="mst" tableName="invoice_data" recordId={result.id} override={getOverride('mst')} onSave={(v) => handleSave('invoice_data', 'mst', v)} onResolve={(a) => handleResolve('mst', a)} />
              <EditableField label="Before-tax Total" value={String(localTotals.tong_tien_truoc_thue || '')} fieldName="tong_tien_truoc_thue" tableName="invoice_data" recordId={result.id} override={getOverride('tong_tien_truoc_thue')} inputType="number" derivedValue={beforeTaxTotalMismatch.hasMismatch ? beforeTaxTotalMismatch.sum : null} showMismatchIcon={beforeTaxTotalMismatch.hasMismatch} onSave={(v) => handleSave('invoice_data', 'tong_tien_truoc_thue', v)} onResolve={(a) => handleResolve('tong_tien_truoc_thue', a)} />
              <EditableField label="Total (incl. tax)" value={String(localTotals.tong_tien || '')} fieldName="tong_tien" tableName="invoice_data" recordId={result.id} override={getOverride('tong_tien')} inputType="number" derivedValue={totalMismatch.hasMismatch ? totalMismatch.sum : null} showMismatchIcon={totalMismatch.hasMismatch} onSave={(v) => handleSave('invoice_data', 'tong_tien', v)} onResolve={(a) => handleResolve('tong_tien', a)} />
              <EditableField label="Counterparty" value={result.ten_doi_tac || ''} fieldName="ten_doi_tac" tableName="invoice_data" recordId={result.id} override={getOverride('ten_doi_tac')} onSave={(v) => handleSave('invoice_data', 'ten_doi_tac', v)} onResolve={(a) => handleResolve('ten_doi_tac', a)} />
              <EditableField label="Address" value={result.dia_chi_doi_tac || ''} fieldName="dia_chi_doi_tac" tableName="invoice_data" recordId={result.id} override={getOverride('dia_chi_doi_tac')} onSave={(v) => handleSave('invoice_data', 'dia_chi_doi_tac', v)} onResolve={(a) => handleResolve('dia_chi_doi_tac', a)} />
              <tr><td className="py-[3px] pr-2 text-3 text-text-secondary font-medium whitespace-nowrap w-[100px] align-top">Date</td><td className="py-[3px] text-3 align-top">{result.ngay || '-'}</td></tr>
            </tbody>
          </table>

          {lineItems.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center justify-between font-semibold text-3 mb-1 text-text-secondary">
                <span>Line Items</span>
                {jeStatus && renderJeIcon(jeStatus)}
              </div>
              <table className="w-full border-collapse text-2.75">
                <thead>
                  <tr>
                    <th className="text-left px-1.5 py-1 font-semibold text-text-secondary border-b border-border">#</th>
                    <th className="text-left px-1.5 py-1 font-semibold text-text-secondary border-b border-border">Description</th>
                    <th className="text-left px-1.5 py-1 font-semibold text-text-secondary border-b border-border">Qty</th>
                    <th className="text-left px-1.5 py-1 font-semibold text-text-secondary border-b border-border">Price</th>
                    <th
                      className={`text-left px-1.5 py-1 font-semibold border-b border-border ${hasColumnIssues.beforeTax ? 'cursor-pointer text-confidence-low' : 'text-text-secondary'}`}
                      onClick={(e) => { if ((e.metaKey || e.ctrlKey) && hasColumnIssues.beforeTax) handleColumnFix('thanh_tien_truoc_thue'); }}
                      title={hasColumnIssues.beforeTax ? '⌘+click to fix column' : undefined}
                    >
                      Before tax{hasColumnIssues.beforeTax && <span className="text-confidence-low font-bold ml-0.5">!</span>}
                    </th>
                    <th className="text-left px-1.5 py-1 font-semibold text-text-secondary border-b border-border">Tax %</th>
                    <th
                      className={`text-left px-1.5 py-1 font-semibold border-b border-border ${hasColumnIssues.afterTax ? 'cursor-pointer text-confidence-low' : 'text-text-secondary'}`}
                      onClick={(e) => { if ((e.metaKey || e.ctrlKey) && hasColumnIssues.afterTax) handleColumnFix('thanh_tien'); }}
                      title={hasColumnIssues.afterTax ? '⌘+click to fix column' : undefined}
                    >
                      After tax{hasColumnIssues.afterTax && <span className="text-confidence-low font-bold ml-0.5">!</span>}
                    </th>
                    <th className="text-left px-1.5 py-1 font-semibold text-text-secondary border-b border-border">TK</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item) => {
                    const itemMismatch = computeLineItemMismatch(item);
                    const taxMismatch = computeTaxRateMismatch(item);
                    const afterTaxMismatch = computeAfterTaxMismatch(item);
                    const hasRowIssue = itemMismatch.hasMismatch || taxMismatch.hasMismatch || afterTaxMismatch.hasMismatch;
                    const je = jeByLineItem.get(item.id) ?? null;
                    return (
                      <tr key={item.id} className={hasRowIssue ? 'line-item-mismatch' : ''}>
                        <td className="px-1.5 py-[3px] border-b border-border">{item.line_number}</td>
                        <EditableCell value={item.mo_ta || ''} fieldName="mo_ta" lineItemId={item.id} override={getLineItemOverride(item.id, 'mo_ta')} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                        <EditableCell value={String(item.so_luong ?? '')} fieldName="so_luong" lineItemId={item.id} override={getLineItemOverride(item.id, 'so_luong')} inputType="number" derivedValue={deriveFieldValue('so_luong', item)} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                        <EditableCell value={String(item.don_gia ?? '')} fieldName="don_gia" lineItemId={item.id} override={getLineItemOverride(item.id, 'don_gia')} inputType="number" derivedValue={deriveFieldValue('don_gia', item)} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                        <EditableCell value={String(item.thanh_tien_truoc_thue ?? '')} fieldName="thanh_tien_truoc_thue" lineItemId={item.id} override={getLineItemOverride(item.id, 'thanh_tien_truoc_thue')} inputType="number" derivedValue={deriveFieldValue('thanh_tien_truoc_thue', item)} showMismatchIcon={itemMismatch.hasMismatch} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                        <EditableCell value={item.thue_suat != null ? String(item.thue_suat) : ''} fieldName="thue_suat" lineItemId={item.id} override={getLineItemOverride(item.id, 'thue_suat')} inputType="number" derivedValue={deriveFieldValue('thue_suat', item)} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                        <EditableCell value={String(item.thanh_tien ?? '')} fieldName="thanh_tien" lineItemId={item.id} override={getLineItemOverride(item.id, 'thanh_tien')} inputType="number" derivedValue={deriveFieldValue('thanh_tien', item)} showMismatchIcon={afterTaxMismatch.hasMismatch} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                        <JeCell account={je?.account ?? null} onSave={(account) => handleSaveJeAccount('line', item.id, account)} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-1.5 py-1">
                <div className="flex items-center gap-2 px-1.5 py-0.5 text-2.75">
                  <span className="min-w-[80px] text-text-secondary">Thue GTGT</span>
                  <span className="flex items-center gap-0.5 text-text-secondary">
                    TK <JeCell account={taxJe?.account ?? null} onSave={(account) => handleSaveJeAccount('tax', null, account)} />
                  </span>
                  <span className="text-text ml-auto">{derivedTaxAmount > 0 ? formatCurrency(derivedTaxAmount) : '–'}</span>
                </div>
                <div className="flex items-center gap-2 px-1.5 py-0.5 text-2.75">
                  <span className="min-w-[80px] text-text-secondary">Thanh toan</span>
                  <span className="flex items-center gap-0.5 text-text-secondary">
                    TK <JeCell account={settlementJe?.account ?? null} onSave={(account) => handleSaveJeAccount('settlement', null, account)} />
                  </span>
                  <span className="text-text ml-auto">{localTotals.tong_tien ? formatCurrency(localTotals.tong_tien) : '–'}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
