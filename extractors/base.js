"use strict";

const { parseVietnameseNumber, formatVietnameseNumber } = require("../lib/textHelpers");

/**
 * Base keyword list used to identify lines that are NOT product name continuations.
 * Exported so format-specific extractors can extend it.
 */
const BASE_CONTINUATION_KEYWORDS = [
  "Tổng hợp", "Tổng cộng", "Thuế suất", "Không kê khai", "Không chịu",
  "Số tiền viết", "Người mua", "Người bán", "Chữ ký", "Tra cứu",
  "Phát hành", "Cần kiểm tra", "Thành tiền", "STT", "Tên hàng",
  "CÔNG TY", "Mã số thuế", "Địa chỉ", "Điện thoại", "Tên đơn vị",
  "MST/CCCD", "Hình thức", "HÓA ĐƠN", "Ngày", "Mã CQT", "Ký hiệu",
  "Thuế", "Tiền chiết", "Tiền thuế", "ĐVT", "Số lượng", "Đơn giá",
  "suất", "khấu", "GTGT", "Cộng tiền", "Trang",
];

/**
 * Determine whether a line is a continuation of a product name
 * (as opposed to a header, table label, or numeric row).
 *
 * @param {string[]} lineParts
 * @param {string[]} [extraKeywords=[]] - Additional keywords to exclude
 * @returns {boolean}
 */
function isProductNameContinuation(lineParts, extraKeywords = []) {
  const joined = lineParts.join(" ");
  if (!joined.trim()) return false;
  if (lineParts.some((p) => /^\d{1,2}%$/.test(p))) return false;
  if (/^\d+$/.test(lineParts[0]) && lineParts.length > 3) return false;
  if (/^[\d.\s]+$/.test(joined.trim())) return false;

  // Filter English-only parenthetical content (table header translations)
  if (/[()]/.test(joined) && !/[\u00C0-\u024F\u1E00-\u1EFF]/.test(joined)) return false;

  const allKeywords = BASE_CONTINUATION_KEYWORDS.concat(extraKeywords);
  if (allKeywords.some((kw) => joined.includes(kw))) return false;
  if (joined.length > 80) return false;

  return true;
}

/**
 * Scan `lines` for STT (line item) rows, claim surrounding text lines as product
 * name continuations, and return parsed items.
 *
 * @param {string[][]} lines - All text lines from the PDF
 * @param {number[]} sttIndices - Indices of lines identified as STT rows
 * @param {Function} parseLineItemFn - Extractor-specific row parser: (parts, isPOSFormat?) => item|null
 * @param {boolean} [isPOSFormat=false] - Enable donGia recovery for POS-format invoices
 * @param {string[]} [extraKeywords=[]] - Extra keywords for isProductNameContinuation
 * @returns {object[]}
 */
function claimNameLines(lines, sttIndices, parseLineItemFn, isPOSFormat = false, extraKeywords = []) {
  const items = [];
  const claimed = new Set();

  for (let s = 0; s < sttIndices.length; s++) {
    const idx = sttIndices[s];
    const item = parseLineItemFn(lines[idx], isPOSFormat);
    if (!item) continue;

    const prevSTT = s > 0 ? sttIndices[s - 1] : -1;
    const nextSTT = s < sttIndices.length - 1 ? sttIndices[s + 1] : lines.length;

    // Collect unclaimed text lines ABOVE this STT row (scan upward, stop at first non-continuation)
    const aboveParts = [];
    for (let j = idx - 1; j > prevSTT; j--) {
      if (!claimed.has(j) && isProductNameContinuation(lines[j], extraKeywords)) {
        aboveParts.unshift(lines[j].join(" "));
        claimed.add(j);
      } else {
        break;
      }
    }

    // Collect unclaimed text lines BELOW this STT row
    const hasNameInDataRow = item.tenHH && item.tenHH.trim().length > 0;
    const belowParts = [];
    for (let j = idx + 1; j < nextSTT; j++) {
      const distToCurrent = j - idx;
      const distToNext = nextSTT - j;
      if (hasNameInDataRow) {
        if (distToNext <= distToCurrent) break;
      } else {
        if (distToNext < distToCurrent) break;
      }
      if (!claimed.has(j) && isProductNameContinuation(lines[j], extraKeywords)) {
        belowParts.push(lines[j].join(" "));
        claimed.add(j);
      }
    }

    // Last item: grab all remaining continuation text below
    if (s === sttIndices.length - 1) {
      for (let j = idx + 1; j < lines.length; j++) {
        if (!claimed.has(j) && isProductNameContinuation(lines[j], extraKeywords)) {
          belowParts.push(lines[j].join(" "));
          claimed.add(j);
        } else if (!isProductNameContinuation(lines[j], extraKeywords)) {
          break;
        }
      }
    }

    // Merge name parts
    const allNameParts = [...aboveParts];
    if (item.tenHH) allNameParts.push(item.tenHH);
    allNameParts.push(...belowParts);
    if (allNameParts.length > 0) {
      item.tenHH = allNameParts.join(" ").trim();
    }

    // POS format: recover donGia from a floating numeric Y-line near this STT.
    // The unit price cell often wraps in the PDF, placing it on a separate line.
    // Also handles split fragments: "30.246,7" + "6" → "30.246,76".
    if (isPOSFormat && !item.donGia && item.soLuong && item.thanhTienTruocThue) {
      const base = parseVietnameseNumber(item.thanhTienTruocThue);
      const qty = parseFloat(item.soLuong);
      const tolerance = Math.max(2, base * 0.01);

      const numLines = [];
      for (let j = prevSTT + 1; j < nextSTT; j++) {
        if (j === idx || claimed.has(j)) continue;
        const lj = lines[j].join(" ").trim();
        if (/^[\d.]+(?:,\d+)?$/.test(lj)) numLines.push({ j, val: lj });
      }

      let priceVal = null;

      // Try single fragment
      for (const { j, val } of numLines) {
        const price = parseVietnameseNumber(val);
        if (!isNaN(price) && Math.abs(price * qty - base) <= tolerance) {
          priceVal = val;
          claimed.add(j);
          break;
        }
      }

      // Try merging two consecutive fragments
      if (!priceVal) {
        for (let k = 0; k < numLines.length - 1; k++) {
          const a = numLines[k], b = numLines[k + 1];
          if (b.j === a.j + 1) {
            const combined = a.val + b.val;
            const price = parseVietnameseNumber(combined);
            if (!isNaN(price) && Math.abs(price * qty - base) <= tolerance) {
              priceVal = combined;
              claimed.add(a.j);
              claimed.add(b.j);
              break;
            }
          }
        }
      }

      if (priceVal) item.donGia = priceVal;
    }

    items.push(item);
  }

  return items;
}

module.exports = {
  BASE_CONTINUATION_KEYWORDS,
  isProductNameContinuation,
  claimNameLines,
};
