#!/usr/bin/env node
/**
 * Generates app icons for macOS (.icns), Windows (.ico), and a 1024px PNG
 * from resources/icon.svg.
 *
 * The SVG uses @media (prefers-color-scheme) which rsvg-convert doesn't
 * support, so we inline the light-theme colors into a temp SVG before
 * converting.
 *
 * Prerequisites:
 *   - rsvg-convert (brew install librsvg)
 *   - macOS iconutil + sips (built-in) for .icns generation
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const RESOURCE_DIR = path.join(__dirname, '..', 'resources');
const SVG_PATH = path.join(RESOURCE_DIR, 'icon.svg');

// Light-theme color map extracted from the SVG
const LIGHT_COLORS = {
  'icon-bg':        '#f0eef9',
  'book-cover':     '#EEEDFE',
  'book-pages':     '#ffffff',
  'book-spine':     '#CECBF6',
  'book-spine-line':'#AFA9EC',
  'page-line':      '#d4d2e8',
  'debit-mark':     '#0F6E56',
  'credit-mark':    '#D85A30',
  'bookmark':       '#534AB7',
};

// book-cover also has a stroke
const BOOK_COVER_STROKE = '#534AB7';

/**
 * Create a flat SVG with explicit inline styles (no @media queries)
 * so rsvg-convert can render it correctly.
 */
function createFlatSvg() {
  let svg = fs.readFileSync(SVG_PATH, 'utf8');

  // Remove the entire <style>...</style> block
  svg = svg.replace(/<style>[\s\S]*?<\/style>\s*/, '');

  // Replace class attributes with inline styles
  for (const [cls, fill] of Object.entries(LIGHT_COLORS)) {
    // For elements with class="cls" — replace with explicit fill
    const classRegex = new RegExp(`class="${cls}"`, 'g');

    if (cls === 'book-cover') {
      svg = svg.replace(classRegex, `fill="${fill}" stroke="${BOOK_COVER_STROKE}"`);
    } else if (cls === 'book-spine-line' || cls === 'page-line') {
      // These use stroke, not fill
      svg = svg.replace(classRegex, `stroke="${fill}"`);
    } else {
      svg = svg.replace(classRegex, `fill="${fill}"`);
    }
  }

  return svg;
}

// ── Helpers ──────────────────────────────────────────────────────────

function svgToPng(svgContent, outPath, size) {
  const tmpSvg = path.join(os.tmpdir(), 'iv-icon-flat.svg');
  fs.writeFileSync(tmpSvg, svgContent);
  execFileSync('rsvg-convert', [
    '-w', String(size),
    '-h', String(size),
    '--background-color', 'transparent',
    tmpSvg,
    '-o', outPath,
  ]);
  fs.unlinkSync(tmpSvg);
}

// ── macOS .icns via iconutil ─────────────────────────────────────────

function buildIcns(sourcePng1024) {
  const iconsetDir = path.join(os.tmpdir(), 'InvoiceVault.iconset');
  if (fs.existsSync(iconsetDir)) fs.rmSync(iconsetDir, { recursive: true });
  fs.mkdirSync(iconsetDir);

  const sizes = [16, 32, 64, 128, 256, 512];
  for (const s of sizes) {
    const outPath = path.join(iconsetDir, `icon_${s}x${s}.png`);
    execFileSync('sips', ['-z', String(s), String(s), sourcePng1024, '--out', outPath]);

    if (s <= 512) {
      const out2x = path.join(iconsetDir, `icon_${s}x${s}@2x.png`);
      const size2x = s * 2;
      if (size2x === 1024) {
        fs.copyFileSync(sourcePng1024, out2x);
      } else {
        execFileSync('sips', ['-z', String(size2x), String(size2x), sourcePng1024, '--out', out2x]);
      }
    }
  }

  const icnsPath = path.join(RESOURCE_DIR, 'icon.icns');
  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath]);
  console.log(`[app-icon] Created ${icnsPath}`);

  fs.rmSync(iconsetDir, { recursive: true });
}

// ── Windows .ico (PNG-compressed, multi-size) ────────────────────────

function buildIco(flatSvg) {
  const icoSizes = [16, 32, 48, 256];
  const pngBuffers = [];

  for (const s of icoSizes) {
    const tmpPng = path.join(os.tmpdir(), `iv-icon-${s}.png`);
    svgToPng(flatSvg, tmpPng, s);
    pngBuffers.push({ size: s, data: fs.readFileSync(tmpPng) });
    fs.unlinkSync(tmpPng);
  }

  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngBuffers.length, 4);

  // Directory entries: 16 bytes each
  const dirSize = pngBuffers.length * 16;
  const directory = Buffer.alloc(dirSize);
  let dataOffset = 6 + dirSize;

  for (let i = 0; i < pngBuffers.length; i++) {
    const { size, data } = pngBuffers[i];
    const off = i * 16;
    directory[off]     = size >= 256 ? 0 : size;
    directory[off + 1] = size >= 256 ? 0 : size;
    directory[off + 2] = 0;
    directory[off + 3] = 0;
    directory.writeUInt16LE(1, off + 4);
    directory.writeUInt16LE(32, off + 6);
    directory.writeUInt32LE(data.length, off + 8);
    directory.writeUInt32LE(dataOffset, off + 12);
    dataOffset += data.length;
  }

  const icoPath = path.join(RESOURCE_DIR, 'icon.ico');
  fs.writeFileSync(icoPath, Buffer.concat([header, directory, ...pngBuffers.map(p => p.data)]));
  console.log(`[app-icon] Created ${icoPath}`);
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(SVG_PATH)) {
    console.error(`[app-icon] SVG source not found: ${SVG_PATH}`);
    process.exit(1);
  }

  const flatSvg = createFlatSvg();

  // 1. Generate 1024x1024 PNG from SVG
  const pngPath = path.join(RESOURCE_DIR, 'icon-1024.png');
  console.log('[app-icon] Rendering 1024x1024 PNG from SVG...');
  svgToPng(flatSvg, pngPath, 1024);
  console.log(`[app-icon] Saved ${pngPath}`);

  // 2. macOS .icns
  if (process.platform === 'darwin') {
    buildIcns(pngPath);
  } else {
    console.log('[app-icon] Skipping .icns (not on macOS)');
  }

  // 3. Windows .ico
  buildIco(flatSvg);

  console.log('[app-icon] Done!');
}

main();
