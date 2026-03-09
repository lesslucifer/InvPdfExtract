"use strict";

/**
 * MISA meInvoice + POS format extractor.
 * Full-featured: handles both standard layout and POS cash-register format.
 * Produces 26-column Excel output with international number formatting.
 */

const {
  parseVietnameseNumber,
  formatVietnameseNumber,
  toIntlNumber,
  stripEnglishParens,
  findAfterColon,
  findValue,
} = require("../lib/textHelpers");
const { claimNameLines } = require("./base");

// Extra keywords specific to MISA/POS invoices that should not be treated as product name lines
const EXTRA_KEYWORDS = [
  "Hàng hóa", "Tính chất", "Tên người mua", "Số tài khoản", "Đơn vị bán hàng",
];

// ─── LINE ITEM PARSER ─────────────────────────────────────

/**
 * Parse a single STT row into a line item object.
 * Handles both M-INVOICE format (3 mid numbers) and POS format (2 mid numbers, donGia on separate line).
 *
 * @param {string[]} parts
 * @param {boolean} [isPOSFormat=false]
 * @returns {object|null}
 */
function parseLineItem(parts, isPOSFormat = false) {
  const stt = parts[0];

  // Use \d{1,2}% to avoid matching "100%" which appears in product names
  const taxIdx = parts.findIndex((p) => /^\d{1,2}%$/.test(p));
  if (taxIdx < 0) return null;

  const taxRate = parts[taxIdx];
  const afterTax = parts.slice(taxIdx + 1).filter((p) => p.trim());
  const midParts = parts.slice(1, taxIdx);

  // Read numbers from the right end of midParts (max 3): qty, unitPrice[, amountBeforeVAT]
  // Also accepts Vietnamese comma-decimal format (e.g. 30.246,76)
  const midNums = [];
  const midText = [];
  for (let i = midParts.length - 1; i >= 0; i--) {
    if (/^[\d.]+(?:,\d+)?$/.test(midParts[i]) && midNums.length < 3) {
      midNums.unshift(midParts[i]);
    } else {
      midText.unshift(...midParts.slice(0, i + 1));
      break;
    }
  }

  const dvt = midText.pop() || "";
  const tenHH = midText.join(" ");

  let soLuong, donGia, thanhTienTruocThue;
  if (midNums.length === 3) {
    // M-INVOICE format: qty | unitPrice | amountBeforeVAT
    [soLuong, donGia, thanhTienTruocThue] = midNums;
  } else if (midNums.length === 2 && isPOSFormat) {
    // POS format: unit price is on a separate Y-line; numbers here are qty | thành_tiền
    soLuong = midNums[0];
    donGia = "";           // recovered later by claimNameLines donGia recovery
    thanhTienTruocThue = midNums[1];
  } else {
    soLuong = midNums[0] || "";
    donGia = midNums[1] || "";
    thanhTienTruocThue = "";
  }

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

  return {
    stt, tenHH, dvt, soLuong, donGia, thanhTienTruocThue,
    thueSuat: taxRate, chietKhau, thanhTienCK, tienThue, thanhTienThue,
  };
}

// ─── INVOICE PARSER ───────────────────────────────────────

/**
 * Parse all lines from a PDF into a structured invoice object.
 * @param {string[][]} lines
 * @returns {{ header: object, items: object[] }}
 */
function parseInvoice(lines) {
  const header = {};

  // Detect POS cash-register format
  const isPOSFormat = lines.some((l) => {
    const j = l.join(" ");
    return j.includes("MÁY TÍNH TIỀN") || j.includes("chưa trừ chiết khấu");
  });

  for (const parts of lines) {
    const joined = parts.join(" ");

    if (joined.includes("Ký hiệu")) {
      header.kyHieu = findAfterColon(parts, "Ký hiệu") || findValue(parts);
    }
    if (joined.includes("Số hóa đơn")) {
      // POS format: "Số hóa đơn:00194880"
      const val = findAfterColon(parts, "Số hóa đơn");
      if (val) header.so = val;
    } else if (joined.match(/^.*Số\s*(?:\([^)]+\)\s*)?:/)) {
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
        findAfterColon(parts, "Mã của cơ quan thuế") ||
        (joined.match(/Mã CQT[^:]*:\s*(.+)/) || [])[1]?.trim() ||
        (joined.match(/Mã của cơ quan thuế[^:]*:\s*(.+)/) || [])[1]?.trim() ||
        "";
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
    if (joined.includes("Tên đơn vị")) {
      header.tenDonVi = findAfterColon(parts, "Tên đơn vị");
    }
    if (joined.includes("MST/CCCD chủ hộ")) {
      const val = findAfterColon(parts, "MST/CCCD chủ hộ");
      if (val && /\d/.test(val)) header.mstKhach = val;
    }
    if (joined.includes("Hình thức thanh toán")) {
      header.hinhThucTT = findAfterColon(parts, "Hình thức thanh toán");
    }
    if (joined.includes("Mã tra cứu")) {
      header.maTraCuu = findAfterColon(parts, "Mã tra cứu");
    }

    // Totals — single line format
    if (joined.includes("Tổng cộng") && joined.match(/[\d.]+/)) {
      const nums = parts.filter((p) => /^[\d.,]+$/.test(p));
      if (nums.length >= 3) {
        header.tongTruocThue = nums[0];
        header.tongThue = nums[1];
        header.tongThanhToan = nums[2];
      }
    }
    // Totals — POS multi-line format
    if (joined.includes("Tổng tiền chưa thuế") && !header.tongTruocThue) {
      const nums = parts.filter((p) => /^[\d.,]+$/.test(p));
      if (nums.length >= 1) header.tongTruocThue = nums[nums.length - 1];
    }
    if (
      joined.includes("Tổng tiền thuế") &&
      !joined.includes("chưa") &&
      !joined.includes("GTGT") &&
      !header.tongThue
    ) {
      const nums = parts.filter((p) => /^[\d.,]+$/.test(p));
      if (nums.length >= 1) header.tongThue = nums[nums.length - 1];
    }
    if (joined.includes("Tổng tiền thanh toán") && !header.tongThanhToan) {
      const nums = parts.filter((p) => /^[\d.,]+$/.test(p));
      if (nums.length >= 1) header.tongThanhToan = nums[nums.length - 1];
    }
  }

  // Detect STT rows and parse line items
  const sttIndices = [];
  for (let i = 0; i < lines.length; i++) {
    // Use \d{1,2}% to avoid matching "100%" in product names
    if (/^\d+$/.test(lines[i][0]) && lines[i].some((p) => /^\d{1,2}%$/.test(p))) {
      sttIndices.push(i);
    }
  }

  const items = claimNameLines(lines, sttIndices, parseLineItem, isPOSFormat, EXTRA_KEYWORDS);

  // Calculate tiền thuế per line when not extracted from PDF (POS format has no per-line VAT column)
  for (const item of items) {
    if (!item.tienThue && item.thanhTienTruocThue && item.thueSuat) {
      const base = parseVietnameseNumber(item.thanhTienTruocThue);
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
    "Tên đơn vị (khách hàng)", "MST/CCCD khách", "Hình thức thanh toán",
    "STT", "Tên hàng hóa", "ĐVT", "Số lượng", "Đơn giá",
    "Thuế suất", "Tiền chiết khấu", "Thành tiền sau CK",
    "Tiền thuế GTGT", "Thành tiền sau thuế",
    "Tổng trước thuế", "Tổng thuế GTGT", "Tổng thanh toán", "Mã tra cứu",
  ];
  const widths = [20, 12, 12, 14, 28, 30, 16, 40, 18, 30, 18, 12, 6, 25, 8, 10, 14, 10, 14, 18, 14, 18, 16, 14, 16, 16];

  function mapRow(fileName, h, item) {
    return [
      fileName.replace(/\.pdf$/i, ""),
      h.kyHieu || "",
      h.so || "",
      h.ngay || "",
      h.maCQT || "",
      h.tenCty || "",
      h.mst || "",
      h.diaChi || "",
      h.dienThoai || "",
      h.tenDonVi || "",
      h.mstKhach || "",
      h.hinhThucTT || "",
      item.stt,
      item.tenHH,
      item.dvt,
      toIntlNumber(item.soLuong),
      toIntlNumber(item.donGia),
      item.thueSuat,
      toIntlNumber(item.chietKhau),
      toIntlNumber(item.thanhTienCK),
      toIntlNumber(item.tienThue),
      toIntlNumber(item.thanhTienThue),
      toIntlNumber(h.tongTruocThue || ""),
      toIntlNumber(h.tongThue || ""),
      toIntlNumber(h.tongThanhToan || ""),
      h.maTraCuu || "",
    ];
  }

  return { headers, widths, autoFilterTo: "Z1", mapRow };
}

module.exports = { parseInvoice, getExcelConfig };
