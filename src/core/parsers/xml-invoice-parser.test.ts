import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { XML_FILES } from '../../__tests__/helpers/fixtures';
import { DocType, ExtractionFileResult, ExtractionInvoiceData } from '../../shared/types';
import { parseXmlInvoice } from './xml-invoice-parser';

describe('XML Invoice Parser', () => {
  // ── Direct format: <HDon><DLHDon>... ──

  describe('Direct format parsing', () => {
    it('parses single-item invoice with 8% tax (In Ky Thuat So #911)', () => {
      const result = parseXmlInvoice(
        XML_FILES.inKyThuatSo911,
        'xml/0310989626_1_C26TAA_911_31012026_congtytnhhinkythuatso.xml',
      );

      expect(result.doc_type).toBe(DocType.InvoiceIn);
      expect(result.error).toBeUndefined();
      expect(result.records).toHaveLength(1);

      const record = result.records[0];
      expect(record.confidence).toBe(1.0);
      expect(record.doc_date).toBe('2026-01-31');

      const data = record.data as ExtractionInvoiceData;
      expect(data.invoice_number).toBe('911');
      expect(data.total_amount).toBe(351000);
      expect(data.tax_id).toBe('0310989626');
      expect(data.counterparty_name).toBe('CÔNG TY TNHH IN KỸ THUẬT SỐ');
      expect(data.counterparty_address).toBe(
        '365 Lê Quang Định, Phường Bình Lợi Trung, Thành Phố Hồ Chí Minh, Việt Nam',
      );

      // Line items
      expect(record.line_items).toHaveLength(1);
      const item = record.line_items![0];
      expect(item.description).toBe('In Kỹ Thuật Số ( PP dán Formax - 3 tấm )');
      expect(item.unit_price).toBe(325000);
      expect(item.quantity).toBe(1);
      expect(item.tax_rate).toBe(8);
      expect(item.subtotal).toBe(325000);
      expect(item.total_with_tax).toBe(351000); // 325000 * 1.08
    });

    it('parses single-item invoice from same seller (In Ky Thuat So #933)', () => {
      const result = parseXmlInvoice(
        XML_FILES.inKyThuatSo933,
        'xml/0310989626_1_C26TAA_933_31012026_congtytnhhinkythuatso.xml',
      );

      expect(result.doc_type).toBe(DocType.InvoiceIn);
      expect(result.records).toHaveLength(1);

      const record = result.records[0];
      expect(record.doc_date).toBe('2026-01-31');

      const data = record.data as ExtractionInvoiceData;
      expect(data.invoice_number).toBe('933');
      expect(data.total_amount).toBe(135000);
      expect(data.tax_id).toBe('0310989626');

      expect(record.line_items).toHaveLength(1);
      const item = record.line_items![0];
      expect(item.description).toBe('In Kỹ Thuật Số ( PP dán Formax )');
      expect(item.unit_price).toBe(125000);
      expect(item.quantity).toBe(1);
      expect(item.tax_rate).toBe(8);
      expect(item.subtotal).toBe(125000);
      expect(item.total_with_tax).toBe(135000); // 125000 * 1.08
    });

    it('parses multi-item invoice and skips TChat=4 rows (Dau Tu Duy Phu)', () => {
      const result = parseXmlInvoice(
        XML_FILES.dauTuDuyPhu,
        'xml/0314499083_1_C26TDP_1_31012026_congtytnhhdautuduyphu.xml',
      );

      expect(result.doc_type).toBe(DocType.InvoiceIn);
      expect(result.records).toHaveLength(1);

      const record = result.records[0];
      const data = record.data as ExtractionInvoiceData;
      expect(data.invoice_number).toBe('1');
      expect(data.total_amount).toBe(8100000);
      expect(data.tax_id).toBe('0314499083');
      expect(data.counterparty_name).toBe('CÔNG TY TNHH ĐẦU TƯ DUY PHÚ');
      expect(data.counterparty_address).toBe(
        '1041/62/162 Trần Xuân Soạn, Khu Phố 5, Phường Tân Hưng, TP Hồ Chí Minh, Việt Nam',
      );

      // Must have exactly 7 line items (the 8th with TChat=4 is description-only)
      expect(record.line_items).toHaveLength(7);

      // First item: Backdrop
      expect(record.line_items![0].description).toBe('Backdrop  Bạt 2 da xám in KTS');
      expect(record.line_items![0].unit_price).toBe(1800000);
      expect(record.line_items![0].quantity).toBe(1);
      expect(record.line_items![0].tax_rate).toBe(8);
      expect(record.line_items![0].subtotal).toBe(1800000);
      expect(record.line_items![0].total_with_tax).toBe(1944000); // 1800000 * 1.08

      // Second item: In PP cán màng mờ
      expect(record.line_items![1].description).toBe('In PP cán màng mờ bồi formex 8mm');
      expect(record.line_items![1].unit_price).toBe(1400000);
      expect(record.line_items![1].subtotal).toBe(1400000);

      // Items 3-5: more In PP cán màng mờ with different prices
      expect(record.line_items![2].unit_price).toBe(1000000);
      expect(record.line_items![3].unit_price).toBe(1100000);
      expect(record.line_items![4].unit_price).toBe(1300000);

      // Item 6: Phí tháo dỡ
      expect(record.line_items![5].description).toBe('Phí tháo dỡ và dọn dẹp');
      expect(record.line_items![5].unit_price).toBe(400000);

      // Item 7: Phí vận chuyển
      expect(record.line_items![6].description).toContain('Phí vận chuyển LALAMOVE');
      expect(record.line_items![6].unit_price).toBe(500000);

      // Verify sum of subtotal equals pre-tax total (TgTCThue)
      const preTaxSum = record.line_items!.reduce((acc, li) => acc + (li.subtotal ?? 0), 0);
      expect(preTaxSum).toBe(7500000);
    });

    it('parses invoice with mixed tax rates 8% and 10% (Zion Restaurant)', () => {
      const result = parseXmlInvoice(
        XML_FILES.zionRestaurant,
        'xml/0318566277_1_C26MTT_1233_31012026_congtytnhhzionrestaurant.xml',
      );

      expect(result.doc_type).toBe(DocType.InvoiceIn);
      expect(result.records).toHaveLength(1);

      const record = result.records[0];
      const data = record.data as ExtractionInvoiceData;
      expect(data.invoice_number).toBe('1233');
      expect(data.total_amount).toBe(4557248);
      expect(data.tax_id).toBe('0318566277');
      expect(data.counterparty_name).toBe('CÔNG TY TNHH ZION RESTAURANT');
      expect(data.counterparty_address).toBe(
        'Tầng 14, Số 87A Hàm Nghi, Phường Sài Gòn, Thành phố Hồ Chí Minh',
      );

      expect(record.line_items).toHaveLength(6);

      // Item 1: Cocktail (10%)
      expect(record.line_items![0].description).toBe('Đồ uống Signature Cocktail Smoke Over Fuji');
      expect(record.line_items![0].unit_price).toBe(320000);
      expect(record.line_items![0].quantity).toBe(1);
      expect(record.line_items![0].tax_rate).toBe(10);
      expect(record.line_items![0].subtotal).toBe(320000);
      expect(record.line_items![0].total_with_tax).toBe(352000); // 320000 * 1.10

      // Item 2: Pornstar Martini (qty 2, 10%)
      expect(record.line_items![1].description).toBe('Rượu Classics With A Twist Pornstar Martini');
      expect(record.line_items![1].unit_price).toBe(300000);
      expect(record.line_items![1].quantity).toBe(2);
      expect(record.line_items![1].tax_rate).toBe(10);
      expect(record.line_items![1].subtotal).toBe(600000);
      expect(record.line_items![1].total_with_tax).toBe(660000); // 600000 * 1.10

      // Item 3: Juice (8%)
      expect(record.line_items![2].description).toBe('Nước trái cây');
      expect(record.line_items![2].unit_price).toBe(2000000);
      expect(record.line_items![2].quantity).toBe(1);
      expect(record.line_items![2].tax_rate).toBe(8);
      expect(record.line_items![2].subtotal).toBe(2000000);
      expect(record.line_items![2].total_with_tax).toBe(2160000); // 2000000 * 1.08

      // Item 4: Wine (10%)
      expect(record.line_items![3].description).toContain('Concha Y Toro');
      expect(record.line_items![3].unit_price).toBe(320000);
      expect(record.line_items![3].quantity).toBe(2);
      expect(record.line_items![3].tax_rate).toBe(10);
      expect(record.line_items![3].subtotal).toBe(640000);
      expect(record.line_items![3].total_with_tax).toBe(704000); // 640000 * 1.10

      // Item 5: Mojito (10%)
      expect(record.line_items![4].description).toBe('Mojito');
      expect(record.line_items![4].unit_price).toBe(280000);
      expect(record.line_items![4].tax_rate).toBe(10);
      expect(record.line_items![4].subtotal).toBe(280000);
      expect(record.line_items![4].total_with_tax).toBe(308000); // 280000 * 1.10

      // Item 6: Service fee (8%)
      expect(record.line_items![5].description).toBe('Phí phục vụ');
      expect(record.line_items![5].unit_price).toBe(345600);
      expect(record.line_items![5].tax_rate).toBe(8);
      expect(record.line_items![5].subtotal).toBe(345600);
      expect(record.line_items![5].total_with_tax).toBe(373248); // 345600 * 1.08
    });
  });

  // ── Wrapped format: <TDiep><DLieu><HDon><DLHDon>... ──

  describe('Wrapped TDiep format parsing', () => {
    it('parses wrapped TDiep format (Van Thinh Phuc)', () => {
      const result = parseXmlInvoice(
        XML_FILES.vanThinhPhuc,
        'xml/0317572493_1_C26TTP_00000056_31012026_congtytnhhvanthinhphuc.xml',
      );

      expect(result.doc_type).toBe(DocType.InvoiceIn);
      expect(result.records).toHaveLength(1);

      const record = result.records[0];
      expect(record.doc_date).toBe('2026-01-31');

      const data = record.data as ExtractionInvoiceData;
      expect(data.invoice_number).toBe('00000056');
      expect(data.total_amount).toBe(529200);
      expect(data.tax_id).toBe('0317572493');
      expect(data.counterparty_name).toBe('CÔNG TY TNHH VẠN THỊNH PHÚC');
      expect(data.counterparty_address).toBe(
        '965/128/14 Quang Trung, Phường An Hội Tây, Thành phố Hồ Chí Minh, Việt Nam',
      );

      expect(record.line_items).toHaveLength(1);
      const item = record.line_items![0];
      expect(item.description).toBe('Giấy nhiệt - Khổ 80x45mm');
      expect(item.unit_price).toBe(4900);
      expect(item.quantity).toBe(100);
      expect(item.tax_rate).toBe(8);
      expect(item.subtotal).toBe(490000);
      expect(item.total_with_tax).toBe(529200); // 490000 * 1.08
    });
  });

  // ── Doc type classification ──

  describe('Doc type classification', () => {
    it('classifies all XML invoices as invoice_in', () => {
      const files = Object.values(XML_FILES);
      for (const filePath of files) {
        const relativePath = path.relative(
          path.resolve(__dirname, '../../../data'),
          filePath,
        );
        const result = parseXmlInvoice(filePath, relativePath);
        expect(result.doc_type).toBe(DocType.InvoiceIn);
      }
    });
  });

  // ── Confidence ──

  describe('Confidence scoring', () => {
    it('returns confidence 1.0 for all structured XML fields', () => {
      const result = parseXmlInvoice(
        XML_FILES.inKyThuatSo911,
        'xml/0310989626_1_C26TAA_911_31012026_congtytnhhinkythuatso.xml',
      );

      const record = result.records[0];
      expect(record.confidence).toBe(1.0);

      // All field confidence should be 1.0
      expect(record.field_confidence.invoice_number).toBe(1.0);
      expect(record.field_confidence.total_amount).toBe(1.0);
      expect(record.field_confidence.tax_id).toBe(1.0);
      expect(record.field_confidence.counterparty_name).toBe(1.0);
      expect(record.field_confidence.doc_date).toBe(1.0);
    });
  });

  // ── Tax rate parsing ──

  describe('Tax rate parsing', () => {
    it('parses "8%" to number 8', () => {
      const result = parseXmlInvoice(
        XML_FILES.inKyThuatSo911,
        'xml/0310989626_1_C26TAA_911_31012026_congtytnhhinkythuatso.xml',
      );
      expect(result.records[0].line_items![0].tax_rate).toBe(8);
    });

    it('parses "10%" to number 10', () => {
      const result = parseXmlInvoice(
        XML_FILES.zionRestaurant,
        'xml/0318566277_1_C26MTT_1233_31012026_congtytnhhzionrestaurant.xml',
      );
      // First item has 10% tax
      expect(result.records[0].line_items![0].tax_rate).toBe(10);
    });
  });

  // ── relative_path ──

  describe('Relative path', () => {
    it('uses the provided relativePath in the result', () => {
      const rel = 'xml/0310989626_1_C26TAA_911_31012026_congtytnhhinkythuatso.xml';
      const result = parseXmlInvoice(XML_FILES.inKyThuatSo911, rel);
      expect(result.relative_path).toBe(rel);
    });
  });

  // ── Error handling ──

  describe('Error handling', () => {
    it('throws or returns error for non-existent file', () => {
      expect(() =>
        parseXmlInvoice('/nonexistent/path.xml', 'nonexistent.xml'),
      ).toThrow();
    });

    it('throws or returns error for malformed XML', () => {
      const tmpFile = path.join(os.tmpdir(), 'malformed-test.xml');
      fs.writeFileSync(tmpFile, '<broken xml!!!');
      try {
        expect(() => parseXmlInvoice(tmpFile, 'malformed.xml')).toThrow();
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('throws or returns error for XML with no HDon element', () => {
      const tmpFile = path.join(os.tmpdir(), 'no-hdon-test.xml');
      fs.writeFileSync(tmpFile, '<?xml version="1.0"?><root><item>data</item></root>');
      try {
        expect(() => parseXmlInvoice(tmpFile, 'no-hdon.xml')).toThrow();
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });
});
