import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { SearchResult, DocType, InvoiceLineItem, FieldOverrideInfo } from '../shared/types';
import { EditableField } from './EditableField';
import { EditableCell } from './EditableCell';
import { computeTotalMismatch, computeBeforeTaxTotalMismatch, computeLineItemMismatch, computeTaxRateMismatch, computeAfterTaxMismatch, deriveFieldValue } from './quickfix-logic';

interface Props {
  result: SearchResult;
  onFieldUpdated: () => void;
}

export const ResultDetail: React.FC<Props> = ({ result, onFieldUpdated }) => {
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
  const [overrides, setOverrides] = useState<FieldOverrideInfo[]>([]);
  const [lineItemOverrides, setLineItemOverrides] = useState<Record<string, FieldOverrideInfo[]>>({});
  const [localTotals, setLocalTotals] = useState<{ tong_tien: number; tong_tien_truoc_thue: number }>({
    tong_tien: result.tong_tien,
    tong_tien_truoc_thue: result.tong_tien_truoc_thue,
  });
  const isBank = result.doc_type === DocType.BankStatement;
  const isInvoice = result.doc_type === DocType.InvoiceIn || result.doc_type === DocType.InvoiceOut;

  // Sync local totals when result prop changes (e.g. different record selected)
  useEffect(() => {
    setLocalTotals({
      tong_tien: result.tong_tien,
      tong_tien_truoc_thue: result.tong_tien_truoc_thue,
    });
  }, [result.id, result.tong_tien, result.tong_tien_truoc_thue]);

  const loadOverrides = useCallback(() => {
    window.api.getFieldOverrides(result.id).then(setOverrides);
  }, [result.id]);

  const loadLineItemOverrides = useCallback((items: InvoiceLineItem[]) => {
    if (items.length === 0) return;
    const ids = items.map(i => i.id);
    window.api.getLineItemOverrides(ids).then(setLineItemOverrides);
  }, []);

  useEffect(() => {
    if (isInvoice) {
      window.api.getLineItems(result.id).then((items) => {
        setLineItems(items);
        loadLineItemOverrides(items);
      });
    }
    loadOverrides();
  }, [result.id, isInvoice, loadOverrides, loadLineItemOverrides]);

  const getOverride = (fieldName: string): FieldOverrideInfo | undefined => {
    return overrides.find(o => o.field_name === fieldName);
  };

  const handleSave = async (tableName: string, fieldName: string, userValue: string) => {
    await window.api.saveFieldOverride({
      recordId: result.id,
      tableName,
      fieldName,
      userValue,
    });
    // Update local totals so the display refreshes immediately
    if (fieldName === 'tong_tien' || fieldName === 'tong_tien_truoc_thue') {
      const numVal = parseFloat(userValue) || 0;
      setLocalTotals(prev => ({ ...prev, [fieldName]: numVal }));
    }
    loadOverrides();
    onFieldUpdated();
  };

  const handleResolve = async (fieldName: string, action: 'keep' | 'accept') => {
    await window.api.resolveConflict(result.id, fieldName, action);
    loadOverrides();
    onFieldUpdated();
  };

  const handleResolveAll = async (action: 'keep' | 'accept') => {
    await window.api.resolveAllConflicts(result.id, action);
    loadOverrides();
    onFieldUpdated();
  };

  const handleLineItemSave = async (lineItemId: string, fieldName: string, userValue: string) => {
    await window.api.saveLineItemField({ lineItemId, fieldName, userValue });
    reloadLineItems();
    onFieldUpdated();
  };

  const handleLineItemResolve = async (lineItemId: string, fieldName: string, action: 'keep' | 'accept') => {
    await window.api.resolveConflict(lineItemId, fieldName, action);
    loadLineItemOverrides(lineItems);
    onFieldUpdated();
  };

  const getLineItemOverride = (lineItemId: string, fieldName: string): FieldOverrideInfo | undefined => {
    const itemOverrides = lineItemOverrides[lineItemId];
    return itemOverrides?.find(o => o.field_name === fieldName);
  };

  const hasConflicts = overrides.some(o => o.status === 'conflict');

  const totalMismatch = useMemo(
    () => computeTotalMismatch(localTotals.tong_tien, lineItems),
    [localTotals.tong_tien, lineItems],
  );

  const beforeTaxTotalMismatch = useMemo(
    () => computeBeforeTaxTotalMismatch(localTotals.tong_tien_truoc_thue, lineItems),
    [localTotals.tong_tien_truoc_thue, lineItems],
  );

  const reloadLineItems = useCallback(() => {
    window.api.getLineItems(result.id).then((items) => {
      setLineItems(items);
      loadLineItemOverrides(items);
    });
  }, [result.id, loadLineItemOverrides]);

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

  return (
    <div className="result-detail">
      {hasConflicts && (
        <div className="batch-conflict-actions">
          <span className="batch-conflict-label">Conflicts detected:</span>
          <button className="conflict-btn keep-btn" onClick={() => handleResolveAll('keep')}>Keep all mine</button>
          <button className="conflict-btn accept-btn" onClick={() => handleResolveAll('accept')}>Accept all AI</button>
        </div>
      )}

      {isBank && (
        <table className="detail-table">
          <tbody>
            <EditableField label="Bank" value={result.ten_ngan_hang || ''} fieldName="ten_ngan_hang" tableName="bank_statement_data" recordId={result.id} override={getOverride('ten_ngan_hang')} onSave={(v) => handleSave('bank_statement_data', 'ten_ngan_hang', v)} onResolve={(a) => handleResolve('ten_ngan_hang', a)} />
            <EditableField label="Account" value={result.stk || ''} fieldName="stk" tableName="bank_statement_data" recordId={result.id} override={getOverride('stk')} onSave={(v) => handleSave('bank_statement_data', 'stk', v)} onResolve={(a) => handleResolve('stk', a)} />
            <EditableField label="Amount" value={String(result.so_tien || '')} fieldName="so_tien" tableName="bank_statement_data" recordId={result.id} override={getOverride('so_tien')} inputType="number" onSave={(v) => handleSave('bank_statement_data', 'so_tien', v)} onResolve={(a) => handleResolve('so_tien', a)} />
            <EditableField label="Counterparty" value={result.ten_doi_tac || ''} fieldName="ten_doi_tac" tableName="bank_statement_data" recordId={result.id} override={getOverride('ten_doi_tac')} onSave={(v) => handleSave('bank_statement_data', 'ten_doi_tac', v)} onResolve={(a) => handleResolve('ten_doi_tac', a)} />
            <EditableField label="Description" value={result.mo_ta || ''} fieldName="mo_ta" tableName="bank_statement_data" recordId={result.id} override={getOverride('mo_ta')} onSave={(v) => handleSave('bank_statement_data', 'mo_ta', v)} onResolve={(a) => handleResolve('mo_ta', a)} />
            <tr><td className="detail-label">Date</td><td>{result.ngay || '-'}</td></tr>
          </tbody>
        </table>
      )}

      {isInvoice && (
        <>
          <table className="detail-table">
            <tbody>
              <EditableField label="Invoice #" value={result.so_hoa_don || ''} fieldName="so_hoa_don" tableName="invoice_data" recordId={result.id} override={getOverride('so_hoa_don')} onSave={(v) => handleSave('invoice_data', 'so_hoa_don', v)} onResolve={(a) => handleResolve('so_hoa_don', a)} />
              <EditableField label="MST" value={result.mst || ''} fieldName="mst" tableName="invoice_data" recordId={result.id} override={getOverride('mst')} onSave={(v) => handleSave('invoice_data', 'mst', v)} onResolve={(a) => handleResolve('mst', a)} />
              <EditableField label="Before-tax Total" value={String(localTotals.tong_tien_truoc_thue || '')} fieldName="tong_tien_truoc_thue" tableName="invoice_data" recordId={result.id} override={getOverride('tong_tien_truoc_thue')} inputType="number" derivedValue={beforeTaxTotalMismatch.hasMismatch ? beforeTaxTotalMismatch.sum : null} showMismatchIcon={beforeTaxTotalMismatch.hasMismatch} onSave={(v) => handleSave('invoice_data', 'tong_tien_truoc_thue', v)} onResolve={(a) => handleResolve('tong_tien_truoc_thue', a)} />
              <EditableField label="Total (incl. tax)" value={String(localTotals.tong_tien || '')} fieldName="tong_tien" tableName="invoice_data" recordId={result.id} override={getOverride('tong_tien')} inputType="number" derivedValue={totalMismatch.hasMismatch ? totalMismatch.sum : null} showMismatchIcon={totalMismatch.hasMismatch} onSave={(v) => handleSave('invoice_data', 'tong_tien', v)} onResolve={(a) => handleResolve('tong_tien', a)} />
              <EditableField label="Counterparty" value={result.ten_doi_tac || ''} fieldName="ten_doi_tac" tableName="invoice_data" recordId={result.id} override={getOverride('ten_doi_tac')} onSave={(v) => handleSave('invoice_data', 'ten_doi_tac', v)} onResolve={(a) => handleResolve('ten_doi_tac', a)} />
              <EditableField label="Address" value={result.dia_chi_doi_tac || ''} fieldName="dia_chi_doi_tac" tableName="invoice_data" recordId={result.id} override={getOverride('dia_chi_doi_tac')} onSave={(v) => handleSave('invoice_data', 'dia_chi_doi_tac', v)} onResolve={(a) => handleResolve('dia_chi_doi_tac', a)} />
              <tr><td className="detail-label">Date</td><td>{result.ngay || '-'}</td></tr>
            </tbody>
          </table>

          {lineItems.length > 0 && (
            <div className="line-items">
              <div className="line-items-header">Line Items</div>
              <table className="line-items-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th className={hasColumnIssues.beforeTax ? 'th-fixable' : ''} onClick={(e) => { if ((e.metaKey || e.ctrlKey) && hasColumnIssues.beforeTax) handleColumnFix('thanh_tien_truoc_thue'); }} title={hasColumnIssues.beforeTax ? '\u2318+click to fix column' : undefined}>Before tax{hasColumnIssues.beforeTax && <span className="th-fix-hint">!</span>}</th>
                    <th>Tax %</th>
                    <th className={hasColumnIssues.afterTax ? 'th-fixable' : ''} onClick={(e) => { if ((e.metaKey || e.ctrlKey) && hasColumnIssues.afterTax) handleColumnFix('thanh_tien'); }} title={hasColumnIssues.afterTax ? '\u2318+click to fix column' : undefined}>After tax{hasColumnIssues.afterTax && <span className="th-fix-hint">!</span>}</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item) => {
                    const itemMismatch = computeLineItemMismatch(item);
                    const taxMismatch = computeTaxRateMismatch(item);
                    const afterTaxMismatch = computeAfterTaxMismatch(item);
                    const hasRowIssue = itemMismatch.hasMismatch || taxMismatch.hasMismatch || afterTaxMismatch.hasMismatch;
                    return (
                    <tr key={item.id} className={hasRowIssue ? 'line-item-mismatch' : ''}>
                      <td>{item.line_number}</td>
                      <EditableCell value={item.mo_ta || ''} fieldName="mo_ta" lineItemId={item.id} override={getLineItemOverride(item.id, 'mo_ta')} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                      <EditableCell value={String(item.so_luong ?? '')} fieldName="so_luong" lineItemId={item.id} override={getLineItemOverride(item.id, 'so_luong')} inputType="number" derivedValue={deriveFieldValue('so_luong', item)} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                      <EditableCell value={String(item.don_gia ?? '')} fieldName="don_gia" lineItemId={item.id} override={getLineItemOverride(item.id, 'don_gia')} inputType="number" derivedValue={deriveFieldValue('don_gia', item)} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                      <EditableCell value={String(item.thanh_tien_truoc_thue ?? '')} fieldName="thanh_tien_truoc_thue" lineItemId={item.id} override={getLineItemOverride(item.id, 'thanh_tien_truoc_thue')} inputType="number" derivedValue={deriveFieldValue('thanh_tien_truoc_thue', item)} showMismatchIcon={itemMismatch.hasMismatch} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                      <EditableCell value={item.thue_suat != null ? String(item.thue_suat) : ''} fieldName="thue_suat" lineItemId={item.id} override={getLineItemOverride(item.id, 'thue_suat')} inputType="number" derivedValue={deriveFieldValue('thue_suat', item)} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                      <EditableCell value={String(item.thanh_tien ?? '')} fieldName="thanh_tien" lineItemId={item.id} override={getLineItemOverride(item.id, 'thanh_tien')} inputType="number" derivedValue={deriveFieldValue('thanh_tien', item)} showMismatchIcon={afterTaxMismatch.hasMismatch} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

    </div>
  );
};
