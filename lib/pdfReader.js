"use strict";

const fs = require("fs");

// Suppress pdfjs warnings about canvas/fonts (not needed for text extraction).
// This patch runs once when this module is first required.
const originalWarn = console.warn;
console.warn = (...args) => {
  if (
    typeof args[0] === "string" &&
    (args[0].includes("Cannot polyfill") ||
      args[0].includes("fetchStandardFontData") ||
      args[0].includes("FlateDecode"))
  )
    return;
  originalWarn(...args);
};

// pdfjs-dist v3.x uses legacy/build/pdf.js (CommonJS).
// v4+ switched to ESM-only (.mjs) which doesn't work with require().
// Pin to v3.11.174 in package.json.
let pdfjsLib;
try {
  pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
} catch {
  try {
    pdfjsLib = require("pdfjs-dist");
  } catch {
    console.error(
      "ERROR: Could not load pdfjs-dist.\n" +
      "Make sure you ran: npm install\n" +
      "If you installed manually, use exactly: npm install pdfjs-dist@3.11.174\n" +
      "(Versions 4+ are ESM-only and won't work with this script)\n"
    );
    process.exit(1);
  }
}

/**
 * Extract positioned text from a PDF file.
 * Groups text items by Y coordinate (same row) and returns an array of lines,
 * where each line is an array of text strings ordered left-to-right.
 *
 * @param {string} pdfPath
 * @returns {Promise<string[][]>}
 */
async function extractTextLines(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data }).promise;

  const allLines = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const textContent = await page.getTextContent();

    // Collect items with position
    const items = textContent.items
      .filter((i) => i.str.trim() !== "")
      .map((i) => ({
        text: i.str.trim(),
        x: Math.round(i.transform[4]),
        y: Math.round(i.transform[5]),
      }));

    // Group by Y position (same row), merging items within ±2px
    const rows = {};
    items.forEach((item) => {
      const yKey =
        Object.keys(rows).find((k) => Math.abs(Number(k) - item.y) <= 2) ||
        item.y;
      if (!rows[yKey]) rows[yKey] = [];
      rows[yKey].push(item);
    });

    // Sort top-to-bottom; items left-to-right within each row
    const sortedYs = Object.keys(rows).map(Number).sort((a, b) => b - a);

    for (const y of sortedYs) {
      rows[y].sort((a, b) => a.x - b.x);
      allLines.push(rows[y].map((i) => i.text));
    }
  }

  return allLines;
}

module.exports = { extractTextLines };
