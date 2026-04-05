#!/usr/bin/env node
/**
 * Downloads better-sqlite3 prebuilts for both:
 *   - Node.js  (NMV 137 — system Node v24.x, used by Vitest)
 *   - Electron (NMV 145 — Electron v41,     used by the app)
 *
 * Stores them as:
 *   node_modules/better-sqlite3/prebuilds/node-v137-darwin-arm64/better_sqlite3.node
 *   node_modules/better-sqlite3/prebuilds/electron-v145-darwin-arm64/better_sqlite3.node
 *
 * Called automatically via the `postinstall` npm script.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const PKG_VERSION = require('../node_modules/better-sqlite3/package.json').version;

// Allow overriding platform/arch via env vars for CI cross-platform builds
const PLATFORM = process.env.PREBUILD_PLATFORM || process.platform;   // 'darwin' | 'linux' | 'win32'
const ARCH     = process.env.PREBUILD_ARCH     || process.arch;       // 'arm64' | 'x64'

// Node ABI varies by Node.js version; Electron ABI is per Electron version.
// When building for a different platform, we only need the Electron prebuilt
// (tests run on the host platform with the host Node ABI).
const ELECTRON_ONLY = !!process.env.PREBUILD_PLATFORM;

const ALL_TARGETS = [
  { runtime: 'node',     abi: '137' },
  { runtime: 'electron', abi: '145' },
];

const TARGETS = ELECTRON_ONLY
  ? ALL_TARGETS.filter(t => t.runtime === 'electron')
  : ALL_TARGETS;

const PREBUILDS_DIR = path.resolve(__dirname, '../node_modules/better-sqlite3/prebuilds');

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return resolve(download(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function extractNodeFile(tarGzBuffer, destPath) {
  const os  = require('os');
  const tmp = path.join(os.tmpdir(), `bsql3-${Date.now()}.tar.gz`);
  const extractDir = path.join(os.tmpdir(), `bsql3-extract-${Date.now()}`);

  fs.writeFileSync(tmp, tarGzBuffer);
  fs.mkdirSync(extractDir, { recursive: true });
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  // Extract entire archive, then find the .node file
  execFileSync('tar', ['-xzf', tmp, '-C', extractDir]);

  const found = findNode(extractDir);
  if (!found) throw new Error('No .node file found in archive');

  fs.copyFileSync(found, destPath);
  fs.unlinkSync(tmp);
  fs.rmSync(extractDir, { recursive: true, force: true });
}

function findNode(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      const found = findNode(full);
      if (found) return found;
    } else if (entry.endsWith('.node')) {
      return full;
    }
  }
  return null;
}

async function main() {
  fs.mkdirSync(PREBUILDS_DIR, { recursive: true });

  for (const { runtime, abi } of TARGETS) {
    const dirName  = `${runtime}-v${abi}-${PLATFORM}-${ARCH}`;
    const destPath = path.join(PREBUILDS_DIR, dirName, 'better_sqlite3.node');

    if (fs.existsSync(destPath)) {
      console.log(`[prebuilts] ${dirName} already exists, skipping`);
      continue;
    }

    const tarName = `better-sqlite3-v${PKG_VERSION}-${runtime}-v${abi}-${PLATFORM}-${ARCH}.tar.gz`;
    const url     = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${PKG_VERSION}/${tarName}`;

    console.log(`[prebuilts] Downloading ${tarName}...`);
    try {
      const buf = await download(url);
      await extractNodeFile(buf, destPath);
      console.log(`[prebuilts] Saved → ${path.relative(process.cwd(), destPath)}`);
    } catch (err) {
      console.error(`[prebuilts] Failed to download ${tarName}: ${err.message}`);
      process.exit(1);
    }
  }
}

main();
