import React, { useEffect, useState } from 'react';
import { SearchResult, DocType, InvoiceLineItem } from '../shared/types';

interface Props {
  result: SearchResult;
  onOpenFile: () => void;
}

function formatAmount(amount: number): string {
  if (!amount) return '-';
  return new Intl.NumberFormat('vi-VN').format(amount);
}

export const ResultDetail: React.FC<Props> = ({ result, onOpenFile }) => {
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
  const isBank = result.doc_type === DocType.BankStatement;
  const isInvoice = result.doc_type === DocType.InvoiceIn || result.doc_type === DocType.InvoiceOut;

  useEffect(() => {
    if (isInvoice) {
      window.api.getLineItems(result.id).then(setLineItems);
    }
  }, [result.id, isInvoice]);

  return (
    <div className="result-detail">
      {isBank && (
        <table className="detail-table">
          <tbody>
            <tr><td className="detail-label">Bank</td><td>{result.ten_ngan_hang || '-'}</td></tr>
            <tr><td className="detail-label">Account</td><td>{result.stk || '-'}</td></tr>
            <tr><td className="detail-label">Amount</td><td>{formatAmount(result.so_tien)}</td></tr>
            <tr><td className="detail-label">Counterparty</td><td>{result.ten_doi_tac || '-'}</td></tr>
            <tr><td className="detail-label">Description</td><td>{result.mo_ta || '-'}</td></tr>
            <tr><td className="detail-label">Date</td><td>{result.ngay || '-'}</td></tr>
          </tbody>
        </table>
      )}

      {isInvoice && (
        <>
          <table className="detail-table">
            <tbody>
              <tr><td className="detail-label">Invoice #</td><td>{result.so_hoa_don || '-'}</td></tr>
              <tr><td className="detail-label">MST</td><td>{result.mst || '-'}</td></tr>
              <tr><td className="detail-label">Total</td><td>{formatAmount(result.tong_tien)}</td></tr>
              <tr><td className="detail-label">Counterparty</td><td>{result.ten_doi_tac || '-'}</td></tr>
              <tr><td className="detail-label">Address</td><td>{result.dia_chi_doi_tac || '-'}</td></tr>
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
                      <td>{item.mo_ta || '-'}</td>
                      <td>{item.so_luong ?? '-'}</td>
                      <td>{item.don_gia != null ? formatAmount(item.don_gia) : '-'}</td>
                      <td>{item.thue_suat != null ? `${item.thue_suat}%` : '-'}</td>
                      <td>{item.thanh_tien != null ? formatAmount(item.thanh_tien) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div className="detail-actions">
        <button className="detail-open-btn" onClick={onOpenFile}>Open Source File</button>
      </div>
    </div>
  );
};
