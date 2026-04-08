import * as fs from 'fs';
import { DocType, ExtractionFileResult, ExtractionInvoiceData, ExtractionLineItem } from '../../shared/types';
import { computeMissingTaxField } from '../../shared/tax-utils';

/**
 * Parse a Vietnamese e-invoice XML file (hóa đơn điện tử) into structured data.
 * Supports two formats:
 *   - Direct: <HDon><DLHDon>...
 *   - Wrapped (TDiep): <TDiep><DLieu><HDon><DLHDon>...
 */
export function parseXmlInvoice(filePath: string, relativePath: string): ExtractionFileResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  const hdonContent = extractHDonContent(content);
  const dlhdon = extractElement(hdonContent, 'DLHDon');
  if (!dlhdon) {
    throw new Error(`No DLHDon element found in ${relativePath}`);
  }

  const ttchung = extractElement(dlhdon, 'TTChung');
  const ndHdon = extractElement(dlhdon, 'NDHDon');
  if (!ttchung || !ndHdon) {
    throw new Error(`Missing TTChung or NDHDon in ${relativePath}`);
  }

  const nban = extractElement(ndHdon, 'NBan');
  const ttoan = extractElement(ndHdon, 'TToan');
  const dsHHDVu = extractElement(ndHdon, 'DSHHDVu');

  const kyHieuHoaDon = getTextContent(ttchung, 'KHHDon');
  const soHoaDon = getTextContent(ttchung, 'SHDon');
  const ngayLap = getTextContent(ttchung, 'NLap');
  const taxId = nban ? getTextContent(nban, 'MST') : null;
  const tenDoiTac = nban ? getTextContent(nban, 'Ten') : null;
  const diaChiDoiTac = nban ? getTextContent(nban, 'DChi') : null;

  // Total with tax (TgTTTBSo) — after-tax
  const tongTien = ttoan ? parseNumber(getTextContent(ttoan, 'TgTTTBSo')) : null;
  // Total before tax (TgTCThue) — before-tax
  const tongTienTruocThue = ttoan ? parseNumber(getTextContent(ttoan, 'TgTCThue')) : null;

  // Parse line items
  const lineItems = parseLineItems(dsHHDVu);

  const data: ExtractionInvoiceData = {
    invoice_code: kyHieuHoaDon ?? undefined,
    invoice_number: soHoaDon ?? undefined,
    total_before_tax: tongTienTruocThue ?? undefined,
    total_amount: tongTien ?? undefined,
    tax_id: taxId ?? undefined,
    counterparty_name: tenDoiTac ?? undefined,
    counterparty_address: diaChiDoiTac ?? undefined,
  };

  const fieldConfidence: Record<string, number> = {
    invoice_code: 1.0,
    invoice_number: 1.0,
    total_before_tax: 1.0,
    total_amount: 1.0,
    tax_id: 1.0,
    counterparty_name: 1.0,
    doc_date: 1.0,
    counterparty_address: 1.0,
  };

  return {
    relative_path: relativePath,
    doc_type: DocType.InvoiceIn,
    records: [{
      confidence: 1.0,
      field_confidence: fieldConfidence,
      doc_date: ngayLap ?? null,
      data,
      line_items: lineItems,
    }],
  };
}

function extractHDonContent(xml: string): string {
  // Try wrapped format: <TDiep>...<DLieu><HDon>...</HDon></DLieu></TDiep>
  const dlieuMatch = xml.match(/<DLieu>([\s\S]*)<\/DLieu>/);
  if (dlieuMatch) {
    const innerHdon = extractElement(dlieuMatch[1], 'HDon');
    if (innerHdon) return innerHdon;
  }

  // Direct format: <HDon>...</HDon>
  const hdonMatch = xml.match(/<HDon[\s>]/);
  if (hdonMatch) return xml;

  throw new Error('No HDon element found in XML');
}

function extractElement(xml: string, tagName: string): string | null {
  // Match the outermost occurrence of <tagName ...>...</tagName>
  const openPattern = new RegExp(`<${tagName}(\\s[^>]*)?>`, 's');
  const openMatch = xml.match(openPattern);
  if (!openMatch) return null;

  const startIdx = openMatch.index!;
  const closeTag = `</${tagName}>`;
  const closeIdx = xml.indexOf(closeTag, startIdx);
  if (closeIdx === -1) return null;

  return xml.substring(startIdx, closeIdx + closeTag.length);
}

function getInnerContent(xml: string, tagName: string): string | null {
  const el = extractElement(xml, tagName);
  if (!el) return null;
  const openTag = el.match(new RegExp(`^<${tagName}(\\s[^>]*)?>`))?.[0];
  if (!openTag) return null;
  const closeTag = `</${tagName}>`;
  return el.substring(openTag.length, el.length - closeTag.length);
}

function getTextContent(xml: string, tagName: string): string | null {
  const inner = getInnerContent(xml, tagName);
  if (inner === null) return null;
  return inner.trim();
}

function parseNumber(value: string | null): number | null {
  if (value === null) return null;
  const cleaned = value.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseTaxRate(value: string | null): number | null {
  if (value === null) return null;
  const cleaned = value.replace('%', '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseLineItems(dsHHDVu: string | null): ExtractionLineItem[] {
  if (!dsHHDVu) return [];

  const items: ExtractionLineItem[] = [];
  // Find all <HHDVu>...</HHDVu> elements
  const regex = /<HHDVu>([\s\S]*?)<\/HHDVu>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(dsHHDVu)) !== null) {
    const itemXml = match[1];

    // Skip description-only rows (TChat=4)
    const tChat = getTextContent(itemXml, 'TChat');
    if (tChat === '4') continue;

    const description = getTextContent(itemXml, 'THHDVu') ?? undefined;
    const unit_price = parseNumber(getTextContent(itemXml, 'DGia')) ?? undefined;
    const quantity = parseNumber(getTextContent(itemXml, 'SLuong')) ?? undefined;
    // ThTien in Vietnamese e-invoice XML is pre-tax amount (thanh tien = subtotal before VAT)
    const subtotal = parseNumber(getTextContent(itemXml, 'ThTien')) ?? undefined;
    const tax_rate = parseTaxRate(getTextContent(itemXml, 'TSuat')) ?? undefined;

    // Compute after-tax from before-tax + rate
    const computed = computeMissingTaxField({
      beforeTax: subtotal,
      taxRate: tax_rate,
    });

    items.push({ description, unit_price, quantity, tax_rate, subtotal, total_with_tax: computed.afterTax ?? undefined });
  }

  return items;
}
