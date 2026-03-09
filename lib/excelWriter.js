"use strict";

const ExcelJS = require("exceljs");

/**
 * Write extraction results to an Excel file.
 *
 * @param {Array<{fileName: string, header: object, items: object[]}>} allResults
 * @param {string} outputPath
 * @param {{
 *   headers: string[],
 *   widths: number[],
 *   autoFilterTo: string,
 *   mapRow: (fileName: string, header: object, item: object) => any[]
 * }} config
 */
async function writeExcel(allResults, outputPath, config) {
  const { headers, widths, autoFilterTo, mapRow } = config;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Extracted Data");

  // Header row
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });

  // Column widths
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  // Data rows
  let rowNum = 1;
  for (const { fileName, header, items } of allResults) {
    for (const item of items) {
      const row = ws.addRow(mapRow(fileName, header, item));

      if (rowNum % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEAF7" } };
        });
      }

      row.eachCell((cell) => {
        cell.font = { name: "Arial", size: 10 };
        cell.border = {
          top: { style: "thin" },
          bottom: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
        };
      });

      rowNum++;
    }
  }

  ws.autoFilter = { from: "A1", to: autoFilterTo };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  await wb.xlsx.writeFile(outputPath);
}

module.exports = { writeExcel };
