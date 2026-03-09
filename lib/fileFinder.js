"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Recursively find all PDF files under `dir`.
 * Returns [{fileName: relativePath, filePath: absolutePath}] sorted by relativePath.
 */
function findPdfFiles(dir, baseDir) {
  baseDir = baseDir || dir;
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findPdfFiles(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      results.push({
        fileName: path.relative(baseDir, fullPath),
        filePath: fullPath,
      });
    }
  }
  results.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return results;
}

module.exports = { findPdfFiles };
