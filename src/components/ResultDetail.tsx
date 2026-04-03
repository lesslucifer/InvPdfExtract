import React, { useEffect, useState, useCallback } from 'react';
import { SearchResult, DocType, InvoiceLineItem, FieldOverrideInfo } from '../shared/types';
import { EditableField } from './EditableField';
import { EditableCell } from './EditableCell';

interface Props {
  result: SearchResult;
  onFieldUpdated: () => void;
}

function formatAmount(amount: number): string {
  if (!amount) return '-';
  return new Intl.NumberFormat('vi-VN').format(amount);
}

export const ResultDetail: React.FC<Props> = ({ result, onFieldUpdated }) => {
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
  const [overrides, setOverrides] = useState<FieldOverrideInfo[]>([]);
  const [lineItemOverrides, setLineItemOverrides] = useState<Record<string, FieldOverrideInfo[]>>({});
  const isBank = result.doc_type === DocType.BankStatement;
  const isInvoice = result.doc_type === DocType.InvoiceIn || result.doc_type === DocType.InvoiceOut;

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
    loadLineItemOverrides(lineItems);
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
              <EditableField label="Total" value={String(result.tong_tien || '')} fieldName="tong_tien" tableName="invoice_data" recordId={result.id} override={getOverride('tong_tien')} inputType="number" onSave={(v) => handleSave('invoice_data', 'tong_tien', v)} onResolve={(a) => handleResolve('tong_tien', a)} />
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
                    <th>Tax %</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.line_number}</td>
                      <EditableCell value={item.mo_ta || ''} fieldName="mo_ta" lineItemId={item.id} override={getLineItemOverride(item.id, 'mo_ta')} onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                      <EditableCell value={String(item.so_luong ?? '')} fieldName="so_luong" lineItemId={item.id} override={getLineItemOverride(item.id, 'so_luong')} inputType="number" onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                      <EditableCell value={String(item.don_gia ?? '')} fieldName="don_gia" lineItemId={item.id} override={getLineItemOverride(item.id, 'don_gia')} inputType="number" onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                      <EditableCell value={item.thue_suat != null ? String(item.thue_suat) : ''} fieldName="thue_suat" lineItemId={item.id} override={getLineItemOverride(item.id, 'thue_suat')} inputType="number" onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                      <EditableCell value={String(item.thanh_tien ?? '')} fieldName="thanh_tien" lineItemId={item.id} override={getLineItemOverride(item.id, 'thanh_tien')} inputType="number" onSave={handleLineItemSave} onResolve={handleLineItemResolve} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

    </div>
  );
};
