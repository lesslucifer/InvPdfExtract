"use strict";

/**
 * Pure string/number utility functions shared across all extractors.
 * No I/O, no dependencies.
 */

/**
 * Parse Vietnamese number format to a JS float.
 * Period = thousands separator, comma = decimal separator.
 * e.g. "60.494" → 60494, "30.246,76" → 30246.76
 */
function parseVietnameseNumber(str) {
  return parseFloat(String(str).replace(/\./g, "").replace(",", "."));
}

/**
 * Format a number using Vietnamese locale (period = thousands).
 * e.g. 4839 → "4.839"
 */
function formatVietnameseNumber(n) {
  return n.toLocaleString("vi-VN");
}

/**
 * Convert Vietnamese display format to international display format.
 * (period=thousands, comma=decimal) → (comma=thousands, period=decimal)
 * e.g. "30.246,76" → "30,246.76",  "60.494" → "60,494"
 */
function toIntlNumber(str) {
  if (!str || typeof str !== "string") return str;
  const s = str.trim();
  if (!s || !/\d/.test(s)) return s;
  if (s.includes(",")) {
    // Has decimal comma: swap both separators
    return s.replace(/\./g, "\x00").replace(",", ".").replace(/\x00/g, ",");
  } else {
    // Dots only = thousands separators
    return s.replace(/\./g, ",");
  }
}

/**
 * Remove English-only labels in parentheses (with optional trailing colon).
 * e.g. "(Serial No)", "(Tax code):", "(Address):"
 */
function stripEnglishParens(str) {
  return str.replace(/\([A-Za-z'\/\s,.:]+\):?/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Find `keyword` in `parts`, return everything after the next colon-separated value.
 * Skips bare ":" parts and English-only parenthetical parts.
 */
function findAfterColon(parts, keyword) {
  const idx = parts.findIndex((p) => p.includes(keyword));
  if (idx < 0) return "";
  const rest = parts
    .slice(idx + 1)
    .filter((p) => p !== ":" && p.trim() && !/^\([A-Za-z'\/\s,.:]+\):?$/.test(p.trim()));
  return rest.join(" ").trim();
}

/**
 * Fallback value extraction: returns content after the last ":" in parts,
 * or the last element if no colon found.
 */
function findValue(parts) {
  const colonIdx = parts.lastIndexOf(":");
  if (colonIdx >= 0 && colonIdx < parts.length - 1) {
    return parts.slice(colonIdx + 1).join(" ").trim();
  }
  return parts[parts.length - 1].trim();
}

module.exports = {
  parseVietnameseNumber,
  formatVietnameseNumber,
  toIntlNumber,
  stripEnglishParens,
  findAfterColon,
  findValue,
};
