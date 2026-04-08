import { t } from '../lib/i18n';
import React, { useEffect, useState, useMemo } from 'react';
import { SearchResult, DocType, InvoiceLineItem, FieldOverrideInfo, JournalEntry, JEGenerationStatus } from '../shared/types';
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

function getJeStatusIconConfig(): Record<string, { icon: LucideIcon; className: string; title: string }> {
  return {
    pending:    { icon: Icons.hourglass, className: 'text-text-muted',                title: t('je_queued', 'Queued for JE generation') },
    processing: { icon: Icons.loader,    className: 'text-accent animate-spin-slow',  title: t('je_generating', 'Generating JE...') },
    done:       { icon: Icons.check,     className: 'text-confidence-high',           title: t('je_done_hint', 'JE generated — click to regenerate · Ctrl/⌘+click for AI only') },
    error:      { icon: Icons.error,     className: 'text-confidence-low',            title: t('je_failed_hint', 'JE generation failed — click to retry · Ctrl/⌘+click for AI only') },
  };
}

export const ResultDetail: React.FC<Props> = ({ result }) => {
  const [localTotals, setLocalTotals] = useState<{ total_amount: number; total_before_tax: number }>({
    total_amount: result.total_amount,
    total_before_tax: result.total_before_tax,
  });
  const [jeStatusRaw, setJeStatusRaw] = useState<JEGenerationStatus | null>(result.je_status);
  const isBank = result.doc_type === DocType.BankStatement;
  const isInvoice = result.doc_type === DocType.InvoiceIn || result.doc_type === DocType.InvoiceOut;

  useEffect(() => {
    setLocalTotals({
      total_amount: result.total_amount,
      total_before_tax: result.total_before_tax,
    });
  }, [result.id, result.total_amount, result.total_before_tax]);

  const { data: detailData } = useResultDetail({ id: result.id });
  const overrides: FieldOverrideInfo[] = detailData?.overrides ?? [];
  const journalEntries = useMemo<JournalEntry[]>(
    () => detailData?.journalEntries ?? [],
    [detailData?.journalEntries],
  );

  const { data: lineItemData } = useLineItems({ id: result.id });
  const lineItems = useMemo<InvoiceLineItem[]>(
    () => lineItemData?.lineItems ?? [],
    [lineItemData?.lineItems],
  );
  const lineItemOverrides: Record<string, FieldOverrideInfo[]> = lineItemData?.lineItemOverrides ?? {};

  const saveFieldOverride = useSaveFieldOverride();
  const saveJournalEntry = useSaveJournalEntry();
  const saveLineItemField = useSaveLineItemField();

  const getOverride = (fieldName: string): FieldOverrideInfo | undefined =>
    overrides.find(o => o.field_name === fieldName);

  const handleSave = async (tableName: string, fieldName: string, userValue: string) => {
    await saveFieldOverride.mutateAsync({ recordId: result.id, tableName, fieldName, userValue });
    if (fieldName === 'total_amount' || fieldName === 'total_before_tax') {
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
    () => computeTotalMismatch(localTotals.total_amount, lineItems),
    [localTotals.total_amount, lineItems],
  );

  const beforeTaxTotalMismatch = useMemo(
    () => computeBeforeTaxTotalMismatch(localTotals.total_before_tax, lineItems),
    [localTotals.total_before_tax, lineItems],
  );

  const hasColumnIssues = useMemo(() => {
    const beforeTax = lineItems.some(i => deriveFieldValue('subtotal', i) != null);
    const afterTax = lineItems.some(i => deriveFieldValue('total_with_tax', i) != null);
    return { beforeTax, afterTax };
  }, [lineItems]);

  const handleColumnFix = async (fieldName: 'subtotal' | 'total_with_tax') => {
    for (const item of lineItems) {
      const derived = deriveFieldValue(fieldName, item);
      if (derived != null) {
        await handleLineItemSave(item.id, fieldName, String(derived));
      }
    }
  };

  // eslint-disable-next-line @spaced-out/i18n/no-static-labels
  const jeStatus: JEGenerationStatus | null = jeStatusRaw ?? (journalEntries.length > 0 ? 'done' : null);

  const handleRegenerateJE = (e: React.MouseEvent) => {
    setJeStatusRaw('pending');
    if (e.ctrlKey || e.metaKey) {
      window.api.regenerateJEAIOnly(result.id);
    } else {
      window.api.regenerateJE(result.id);
    }
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
  const invoiceJe = useMemo(() => journalEntries.find(je => je.entry_type === 'invoice') ?? null, [journalEntries]);

  const derivedTaxAmount = useMemo(() => {
    return lineItems
      .filter(li => li.tax_rate != null && li.tax_rate > 0)
      .reduce((sum, li) => {
        const before = li.subtotal ?? 0;
        const after = li.total_with_tax ?? 0;
        return sum + (after - before);
      }, 0);
  }, [lineItems]);

  const handleSaveJeAccount = async (entryType: 'line' | 'tax' | 'settlement' | 'bank' | 'invoice', lineItemId: string | null, account: string, contraAccount?: string) => {
    await saveJournalEntry.mutateAsync({ recordId: result.id, lineItemId: lineItemId ?? undefined, entryType, account, contraAccount });
  };

  const renderJeIcon = (status: string) => {
    const config = getJeStatusIconConfig()[status];
    if (!config) return null;
    const Icon = config.icon;
    return (
      <span
        className={`inline-flex items-center ml-1.5 align-middle cursor-pointer shrink-0 ${config.className}`}
        title={config.title}
        onClick={(e) => handleRegenerateJE(e)}
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
          <span className="text-confidence-medium font-semibold">{`${t('conflicts_detected', 'Conflicts detected')}:`}</span>
          <button className="border-none rounded px-2 py-[2px] text-2.75 font-medium cursor-pointer bg-bg-hover text-text hover:bg-border" onClick={() => handleResolveAll('keep')}>{t('keep_all_mine', 'Keep all mine')}</button>
          <button className="border-none rounded px-2 py-[2px] text-2.75 font-medium cursor-pointer bg-accent text-white hover:opacity-85" onClick={() => handleResolveAll('accept')}>{t('accept_all_ai', 'Accept all AI')}</button>
        </div>
      )}

      {isBank && (
        <table className="w-full border-collapse">
          <tbody>
            <EditableField label={t('bank', 'Bank')} value={result.bank_name || ''} fieldName="bank_name" tableName="bank_statement_data" recordId={result.id} override={getOverride('bank_name')} onSave={(v) => handleSave('bank_statement_data', 'bank_name', v)} onResolve={(a) => handleResolve('bank_name', a)} />
            <EditableField label={t('account', 'Account')} value={result.account_number || ''} fieldName="account_number" tableName="bank_statement_data" recordId={result.id} override={getOverride('account_number')} onSave={(v) => handleSave('bank_statement_data', 'account_number', v)} onResolve={(a) => handleResolve('account_number', a)} />
            <EditableField label={t('invoice_code', 'Invoice Code')} value={result.invoice_code || ''} fieldName="invoice_code" tableName="bank_statement_data" recordId={result.id} override={getOverride('invoice_code')} onSave={(v) => handleSave('bank_statement_data', 'invoice_code', v)} onResolve={(a) => handleResolve('invoice_code', a)} />
            <EditableField label={t('invoice_number', 'Invoice #')} value={result.invoice_number || ''} fieldName="invoice_number" tableName="bank_statement_data" recordId={result.id} override={getOverride('invoice_number')} onSave={(v) => handleSave('bank_statement_data', 'invoice_number', v)} onResolve={(a) => handleResolve('invoice_number', a)} />
            <EditableField label={t('amount', 'Amount')} value={String(result.amount || '')} fieldName="amount" tableName="bank_statement_data" recordId={result.id} override={getOverride('amount')} inputType="number" onSave={(v) => handleSave('bank_statement_data', 'amount', v)} onResolve={(a) => handleResolve('amount', a)} />
            <EditableField label={t('counterparty', 'Counterparty')} value={result.counterparty_name || ''} fieldName="counterparty_name" tableName="bank_statement_data" recordId={result.id} override={getOverride('counterparty_name')} onSave={(v) => handleSave('bank_statement_data', 'counterparty_name', v)} onResolve={(a) => handleResolve('counterparty_name', a)} />
            <EditableField label={t('description', 'Description')} value={result.description || ''} fieldName="description" tableName="bank_statement_data" recordId={result.id} override={getOverride('description')} onSave={(v) => handleSave('bank_statement_data', 'description', v)} onResolve={(a) => handleResolve('description', a)} />
            <tr><td className="py-[3px] pr-2 text-3 text-text-secondary font-medium whitespace-nowrap w-[100px] align-top">{t('date', 'Date')}</td><td className="py-[3px] text-3 align-top">{result.doc_date || '-'}</td></tr>
            <tr>
              <td className="py-[3px] pr-2 text-3 text-text-secondary font-medium whitespace-nowrap w-[100px] align-top">
                {t('tk', 'TK')}
                {jeStatus && renderJeIcon(jeStatus)}
              </td>
              <JeCell account={bankJe?.account ?? null} contraAccount={bankJe?.contra_account ?? null} onSave={(account, contra) => handleSaveJeAccount('bank', null, account, contra)} />
            </tr>
          </tbody>
        </table>
      )}

      {isInvoice && (
        <>
          <table className="w-full border-collapse">
            <tbody>
              <EditableField label={t('invoice_code', 'Invoice Code')} value={result.invoice_code || ''} fieldName="invoice_code" tableName="invoice_data" recordId={result.id} override={getOverride('invoice_code')} onSave={(v) => handleSave('invoice_data', 'invoice_code', v)} onResolve={(a) => handleResolve('invoice_code', a)} />
              <EditableField label={t('invoice_number', 'Invoice #')} value={result.invoice_number || ''} fieldName="invoice_number" tableName="invoice_data" recordId={result.id} override={getOverride('invoice_number')} onSave={(v) => handleSave('invoice_data', 'invoice_number', v)} onResolve={(a) => handleResolve('invoice_number', a)} />
              <EditableField label={t('tax_id_label', 'TaxID')} value={result.tax_id || ''} fieldName="tax_id" tableName="invoice_data" recordId={result.id} override={getOverride('tax_id')} onSave={(v) => handleSave('invoice_data', 'tax_id', v)} onResolve={(a) => handleResolve('tax_id', a)} />
              <EditableField label={t('before_tax_total', 'Before-tax Total')} value={String(localTotals.total_before_tax || '')} fieldName="total_before_tax" tableName="invoice_data" recordId={result.id} override={getOverride('total_before_tax')} inputType="number" derivedValue={beforeTaxTotalMismatch.hasMismatch ? beforeTaxTotalMismatch.sum : null} showMismatchIcon={beforeTaxTotalMismatch.hasMismatch} onSave={(v) => handleSave('invoice_data', 'total_before_tax', v)} onResolve={(a) => handleResolve('total_before_tax', a)} />
              <EditableField label={t('total_incl_tax', 'Total (incl. tax)')} value={String(localTotals.total_amount || '')} fieldName="total_amount" tableName="invoice_data" recordId={result.id} override={getOverride('total_amount')} inputType="number" derivedValue={totalMismatch.hasMismatch ? totalMismatch.sum : null} showMismatchIcon={totalMismatch.hasMismatch} onSave={(v) => handleSave('invoice_data', 'total_amount', v)} onResolve={(a) => handleResolve('total_amount', a)} />
              <EditableField label={t('counterparty', 'Counterparty')} value={result.counterparty_name || ''} fieldName="counterparty_name" tableName="invoice_data" recordId={result.id} override={getOverride('counterparty_name')} onSave={(v) => handleSave('invoice_data', 'counterparty_name', v)} onResolve={(a) => handleResolve('counterparty_name', a)} />
              <EditableField label={t('address', 'Address')} value={result.counterparty_address || ''} fieldName="counterparty_address" tableName="invoice_data" recordId={result.id} override={getOverride('counterparty_address')} onSave={(v) => handleSave('invoice_data', 'counterparty_address', v)} onResolve={(a) => handleResolve('counterparty_address', a)} />
              <tr><td className="py-[3px] pr-2 text-3 text-text-secondary font-medium whitespace-nowrap w-[100px] align-top">{t('date', 'Date')}</td><td className="py-[3px] text-3 align-top">{result.doc_date || '-'}</td></tr>
            </tbody>
          </table>

          {lineItems.length > 0 ? (
            <div className="mt-2">
              <div className="flex items-center justify-between font-semibold text-3 mb-1 text-text-secondary">
                <span>{t('line_items', 'Line Items')}</span>
                {jeStatus && renderJeIcon(jeStatus)}
              </div>
              <table className="w-full border-collapse text-2.75">
                <thead>
                  <tr>
                    <th className="text-left px-1.5 py-1 font-semibold text-text-secondary border-b border-border">#</th>
                    <th className="text-left px-1.5 py-1 font-semibold text-text-secondary border-b border-border">{t('description', 'Description')}</th>
                    <th className="text-left px-1.5 py-1 font-semibold text-text-secondary border-b border-border">{t('qty', 'Qty')}</th>
                    <th className="text-left px-1.5 py-1 font-semibold text-text-secondary border-b border-border">{t('price', 'Price')}</th>
                    <th
                      className={`text-left px-1.5 py-1 font-semibold border-b border-border ${hasColumnIssues.beforeTax ? 'cursor-pointer text-confidence-low' : 'text-text-secondary'}`}
                      onClick={(e) => { if ((e.metaKey || e.ctrlKey) && hasColumnIssues.beforeTax) handleColumnFix('subtotal'); }}
                      title={hasColumnIssues.beforeTax ? t('cmd_click_fix_column', '⌘+click to fix column') : undefined}
                    >{t('before_tax', 'Before tax')}{hasColumnIssues.beforeTax && <span className="text-confidence-low font-bold ml-0.5">!</span>}
                    </th>
                    <th className="text-left px-1.5 py-1 font-semibold text-text-secondary border-b border-border">{`${t('tax', 'Tax')} %`}</th>
                    <th
                      className={`text-left px-1.5 py-1 font-semibold border-b border-border ${hasColumnIssues.afterTax ? 'cursor-pointer text-confidence-low' : 'text-text-secondary'}`}
                      onClick={(e) => { if ((e.metaKey || e.ctrlKey) && hasColumnIssues.afterTax) handleColumnFix('total_with_tax'); }}
                      title={hasColumnIssues.afterTax ? t('cmd_click_fix_column', '⌘+click to fix column') : undefined}
                    >{t('after_tax', 'After tax')}{hasColumnIssues.afterTax && <span className="text-confidence-low font-bold ml-0.5">!</span>}
                    </th>
                    <th className="text-left px-1.5 py-1 font-semibold text-text-secondary border-b border-border">{t('tk', 'TK')}</th>
                    <th className="text-left px-1.5 py-1 font-semibold text-text-secondary border-b border-border">{t('tk_du', 'TK ĐƯ')}</th>
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
                        <EditableCell value={item.description || ''} fieldName="description" lineItemId={item.id} override={getLineItemOverride(item.id, 'description')} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                        <EditableCell value={String(item.quantity ?? '')} fieldName="quantity" lineItemId={item.id} override={getLineItemOverride(item.id, 'quantity')} inputType="number" derivedValue={deriveFieldValue('quantity', item)} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                        <EditableCell value={String(item.unit_price ?? '')} fieldName="unit_price" lineItemId={item.id} override={getLineItemOverride(item.id, 'unit_price')} inputType="number" derivedValue={deriveFieldValue('unit_price', item)} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                        <EditableCell value={String(item.subtotal ?? '')} fieldName="subtotal" lineItemId={item.id} override={getLineItemOverride(item.id, 'subtotal')} inputType="number" derivedValue={deriveFieldValue('subtotal', item)} showMismatchIcon={itemMismatch.hasMismatch} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                        <EditableCell value={item.tax_rate != null ? String(item.tax_rate) : ''} fieldName="tax_rate" lineItemId={item.id} override={getLineItemOverride(item.id, 'tax_rate')} inputType="number" derivedValue={deriveFieldValue('tax_rate', item)} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                        <EditableCell value={String(item.total_with_tax ?? '')} fieldName="total_with_tax" lineItemId={item.id} override={getLineItemOverride(item.id, 'total_with_tax')} inputType="number" derivedValue={deriveFieldValue('total_with_tax', item)} showMismatchIcon={afterTaxMismatch.hasMismatch} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                        <JeCell account={je?.account ?? null} onSave={(account, contra) => handleSaveJeAccount('line', item.id, account, contra)} />
                        <JeCell account={je?.contra_account ?? null} onSave={(contra) => handleSaveJeAccount('line', item.id, je?.account ?? '', contra)} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-1.5 py-1">
                <div className="flex items-center gap-2 px-1.5 py-0.5 text-2.75">
                  <span className="min-w-[80px] text-text-secondary">{t('thue_gtgt', 'Thue GTGT')}</span>
                  <span className="flex items-center gap-0.5 text-text-secondary">{`${t('tk', 'TK')} `}<JeCell account={taxJe?.account ?? null} contraAccount={taxJe?.contra_account ?? null} onSave={(account, contra) => handleSaveJeAccount('tax', null, account, contra)} />
                  </span>
                  <span className="text-text ml-auto">{derivedTaxAmount > 0 ? formatCurrency(derivedTaxAmount) : '–'}</span>
                </div>
                <div className="flex items-center gap-2 px-1.5 py-0.5 text-2.75">
                  <span className="min-w-[80px] text-text-secondary">{t('thanh_toan', 'Thanh toan')}</span>
                  <span className="flex items-center gap-0.5 text-text-secondary">{`${t('tk', 'TK')} `}<JeCell account={settlementJe?.account ?? null} contraAccount={settlementJe?.contra_account ?? null} onSave={(account, contra) => handleSaveJeAccount('settlement', null, account, contra)} />
                  </span>
                  <span className="text-text ml-auto">{localTotals.total_amount ? formatCurrency(localTotals.total_amount) : '–'}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <div className="flex items-center justify-between font-semibold text-3 mb-1 text-text-secondary">
                <span>{t('invoice_total', 'Invoice Total')}</span>
                {jeStatus && renderJeIcon(jeStatus)}
              </div>
              <div className="py-1">
                <div className="flex items-center gap-2 px-1.5 py-0.5 text-2.75">
                  <span className="min-w-[80px] text-text-secondary">{t('hang_dich_vu', 'Hàng/dịch vụ')}</span>
                  <span className="flex items-center gap-0.5 text-text-secondary">{`${t('tk', 'TK')} `}<JeCell account={invoiceJe?.account ?? null} contraAccount={invoiceJe?.contra_account ?? null} onSave={(account, contra) => handleSaveJeAccount('invoice', null, account, contra)} />
                  </span>
                  <span className="text-text ml-auto">{localTotals.total_before_tax ? formatCurrency(localTotals.total_before_tax) : '–'}</span>
                </div>
                <div className="flex items-center gap-2 px-1.5 py-0.5 text-2.75">
                  <span className="min-w-[80px] text-text-secondary">{t('thue_gtgt', 'Thue GTGT')}</span>
                  <span className="flex items-center gap-0.5 text-text-secondary">{`${t('tk', 'TK')} `}<JeCell account={taxJe?.account ?? null} contraAccount={taxJe?.contra_account ?? null} onSave={(account, contra) => handleSaveJeAccount('tax', null, account, contra)} />
                  </span>
                  <span className="text-text ml-auto">
                    {(localTotals.total_amount && localTotals.total_before_tax)
                      ? formatCurrency(localTotals.total_amount - localTotals.total_before_tax)
                      : '–'}
                  </span>
                </div>
                <div className="flex items-center gap-2 px-1.5 py-0.5 text-2.75">
                  <span className="min-w-[80px] text-text-secondary">{t('thanh_toan', 'Thanh toan')}</span>
                  <span className="flex items-center gap-0.5 text-text-secondary">{`${t('tk', 'TK')} `}<JeCell account={settlementJe?.account ?? null} contraAccount={settlementJe?.contra_account ?? null} onSave={(account, contra) => handleSaveJeAccount('settlement', null, account, contra)} />
                  </span>
                  <span className="text-text ml-auto">{localTotals.total_amount ? formatCurrency(localTotals.total_amount) : '–'}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
