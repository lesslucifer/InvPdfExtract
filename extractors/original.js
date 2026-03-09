"use strict";

/**
 * Original MISA invoice format extractor.
 * Simpler totals parsing, 24-column Excel output, raw Vietnamese number strings.
 */

const {
  parseVietnameseNumber,
  formatVietnameseNumber,
  stripEnglishParens,
  findAfterColon,
  findValue,
} = require("../lib/textHelpers");
const { claimNameLines } = require("./base");

// ─── LINE ITEM PARSER ─────────────────────────────────────

/**
 * Parse a single STT row into a line item object.
 * Expected column order: STT, Name, DVT, Qty, UnitPrice, TaxRate%, [Discount, SubtotalCK,] VAT, Total
 */
function parseLineItem(parts) {
  const stt = parts[0];

  const taxIdx = parts.findIndex((p) => /^\d+%$/.test(p));
  if (taxIdx < 0) return null;

  const taxRate = parts[taxIdx];
  const afterTax = parts.slice(taxIdx + 1).filter((p) => p.trim());
  const midParts = parts.slice(1, taxIdx);

  // Read numbers from the right end of midParts: qty, unit_price (max 2)
  const midNums = [];
  const midText = [];
  for (let i = midParts.length - 1; i >= 0; i--) {
    if (/^[\d.]+$/.test(midParts[i]) && midNums.length < 2) {
      midNums.unshift(midParts[i]);
    } else {
      midText.unshift(...midParts.slice(0, i + 1));
      break;
    }
  }

  const dvt = midText.pop() || "";
  const tenHH = midText.join(" ");
  const soLuong = midNums[0] || "";
  const donGia = midNums[1] || "";

  let chietKhau, thanhTienCK, tienThue, thanhTienThue;
  if (afterTax.length <= 2) {
    chietKhau = "";
    thanhTienCK = "";
    tienThue = afterTax[0] || "";
    thanhTienThue = afterTax[1] || "";
  } else {
    chietKhau = afterTax[0] || "";
    thanhTienCK = afterTax[1] || "";
    tienThue = afterTax[2] || "";
    thanhTienThue = afterTax[3] || "";
  }

  return { stt, tenHH, dvt, soLuong, donGia, thueSuat: taxRate, chietKhau, thanhTienCK, tienThue, thanhTienThue };
}

// ─── INVOICE PARSER ───────────────────────────────────────

/**
 * Parse all lines from a PDF into a structured invoice object.
 * @param {string[][]} lines
 * @returns {{ header: object, items: object[] }}
 */
function parseInvoice(lines) {
  const header = {};

  for (const parts of lines) {
    const joined = parts.join(" ");

    if (joined.includes("Ký hiệu")) {
      header.kyHieu = findAfterColon(parts, "Ký hiệu") || findValue(parts);
    }
    if (joined.match(/^.*Số\s*(?:\([^)]+\)\s*)?:/)) {
      header.so = findAfterColon(parts, "Số") || parts[parts.length - 1].trim();
    }
    if (/^\d{5,}$/.test(joined.trim()) && !header.so) {
      header.so = joined.trim();
    }
    if (joined.includes("Ngày") && joined.includes("tháng")) {
      const m = joined.match(
        /Ngày[^0-9]*(\d{1,2})[^0-9]*tháng[^0-9]*(\d{1,2})[^0-9]*năm[^0-9]*(\d{4})/
      );
      if (m) header.ngay = `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`;
    }
    if (joined.includes("Mã CQT") || joined.includes("Mã của cơ quan thuế")) {
      header.maCQT =
        findAfterColon(parts, "Mã CQT") ||
        findAfterColon(parts, "Mã của cơ quan thuế");
    }
    if (joined.includes("Đơn vị bán hàng") && !header.tenCty) {
      header.tenCty = findAfterColon(parts, "Đơn vị bán hàng");
    }
    if (joined.match(/^CÔNG TY/) && !header.tenCty) {
      header.tenCty = joined;
    }
    if (joined.includes("Mã số thuế")) {
      const afterColon = parts.slice(parts.findIndex((p) => p.includes("Mã số thuế")) + 1);
      const raw = stripEnglishParens(afterColon.filter((p) => p !== ":").join("").trim());
      const mstVal = (raw.match(/^\d+/) || [""])[0];
      if (!header.mst) header.mst = mstVal;
    }
    if (joined.includes("Địa chỉ") && joined.length > 20 && !header.diaChi) {
      header.diaChi = findAfterColon(parts, "Địa chỉ");
    }
    if (joined.includes("Điện thoại") && joined.match(/\d{3}/)) {
      if (!header.dienThoai) header.dienThoai = findAfterColon(parts, "Điện thoại");
    }
    if (joined.includes("Mã tra cứu")) {
      header.maTraCuu = findAfterColon(parts, "Mã tra cứu");
    }

    // Totals (single "Tổng cộng" line with three numbers)
    if (joined.includes("Tổng cộng") && joined.match(/[\d.]+/)) {
      const nums = parts.filter((p) => /^[\d.]+$/.test(p));
      if (nums.length >= 3) {
        header.tongTruocThue = nums[0];
        header.tongThue = nums[1];
        header.tongThanhToan = nums[2];
      }
    }
  }

  // Detect STT rows and parse line items
  const sttIndices = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\d+$/.test(lines[i][0]) && lines[i].some((p) => /^\d+%$/.test(p))) {
      sttIndices.push(i);
    }
  }

  const items = claimNameLines(lines, sttIndices, parseLineItem);

  // Calculate tiền thuế per line when not extracted from PDF
  for (const item of items) {
    if (!item.tienThue && item.donGia && item.soLuong && item.thueSuat) {
      const base = parseVietnameseNumber(item.donGia) * parseFloat(item.soLuong);
      const rate = parseFloat(item.thueSuat.replace("%", "")) / 100;
      if (!isNaN(base) && !isNaN(rate)) {
        item.tienThue = formatVietnameseNumber(Math.round(base * rate));
      }
    }
  }

  return { header, items };
}

// ─── EXCEL CONFIG ─────────────────────────────────────────

function getExcelConfig() {
  const headers = [
    "File Name", "Ký hiệu", "Số", "Ngày", "Mã CQT",
    "Tên công ty", "Mã số thuế", "Địa chỉ", "Điện thoại",
    "STT", "Tên hàng hóa", "ĐVT", "Số lượng", "Đơn giá",
    "Thành tiền chưa thuế", "Thuế suất", "Tiền chiết khấu",
    "Thành tiền sau CK", "Tiền thuế GTGT", "Thành tiền sau thuế",
    "Tổng trước thuế", "Tổng thuế GTGT", "Tổng thanh toán", "Mã tra cứu",
  ];
  const widths = [20, 12, 12, 14, 28, 30, 16, 40, 18, 6, 25, 8, 10, 14, 16, 10, 14, 18, 14, 18, 16, 14, 16, 16];

  function mapRow(fileName, h, item) {
    return [
      fileName,
      h.kyHieu || "",
      h.so || "",
      h.ngay || "",
      h.maCQT || "",
      h.tenCty || "",
      h.mst || "",
      h.diaChi || "",
      h.dienThoai || "",
      item.stt,
      item.tenHH,
      item.dvt,
      item.soLuong,
      item.donGia,
      "", // thanhTienTruocThue not available in original format
      item.thueSuat,
      item.chietKhau,
      item.thanhTienCK,
      item.tienThue,
      item.thanhTienThue,
      h.tongTruocThue || "",
      h.tongThue || "",
      h.tongThanhToan || "",
      h.maTraCuu || "",
    ];
  }

  return { headers, widths, autoFilterTo: "X1", mapRow };
}

module.exports = { parseInvoice, getExcelConfig };
