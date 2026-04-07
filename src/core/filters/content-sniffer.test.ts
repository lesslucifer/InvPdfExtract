import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { contentSniffer, extractXmlText } from './content-sniffer';
import { DEFAULT_FILTER_CONFIG } from '../../shared/constants';

const cfg = DEFAULT_FILTER_CONFIG;

describe('contentSniffer — XML files', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-sniffer-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scores invoice XML high (> processThreshold)', async () => {
    const xml = `<?xml version="1.0"?>
<HoaDon>
  <MaSoThue>0101234567</MaSoThue>
  <SoHoaDon>HD001</SoHoaDon>
  <TongTien>11000000</TongTien>
  <ThueSuat>10</ThueSuat>
  <TenNguoiMua>Cong ty ABC</TenNguoiMua>
</HoaDon>`;
    const file = path.join(tmpDir, 'invoice.xml');
    fs.writeFileSync(file, xml);

    const result = await contentSniffer(file, 0, cfg);
    expect(result.score).toBeGreaterThan(cfg.processThreshold);
    expect(result.decision).toBe('process');
  });

  it('returns a FilterResult with layer=2 for XML', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><data><item>test</item></data>`;
    const file = path.join(tmpDir, 'data.xml');
    fs.writeFileSync(file, xml);

    const result = await contentSniffer(file, 0, cfg);
    expect(result.layer).toBe(2);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe('contentSniffer — image files', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-sniffer-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes through for image files with layer1Score', async () => {
    const file = path.join(tmpDir, 'photo.jpg');
    fs.writeFileSync(file, 'fake jpg content');

    const result = await contentSniffer(file, 0.7, cfg);
    expect(result.layer).toBe(2);
    expect(result.score).toBe(0.7);
    expect(result.decision).toBe('process'); // 0.7 > processThreshold 0.6
  });

  it('returns uncertain for image with no layer1 signal', async () => {
    const file = path.join(tmpDir, 'photo.png');
    fs.writeFileSync(file, 'fake png content');

    const result = await contentSniffer(file, 0.5, cfg); // 0.5 is in uncertain range
    expect(result.decision).toBe('uncertain');
  });
});

describe('contentSniffer — missing file', () => {
  it('returns uncertain on extraction error', async () => {
    const result = await contentSniffer('/nonexistent/path/file.pdf', 0.3, cfg);
    expect(result.decision).toBe('uncertain');
    expect(result.reason).toContain('Content extraction failed');
  });
});

describe('contentSniffer — score combining', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-sniffer-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('combines layer1 and content scores using probability union', async () => {
    const xml = `<data><invoice>test</invoice><VAT>10</VAT></data>`;
    const file = path.join(tmpDir, 'doc.xml');
    fs.writeFileSync(file, xml);

    const resultNoBoost = await contentSniffer(file, 0, cfg);
    const resultWithBoost = await contentSniffer(file, 0.3, cfg);

    // Combined score should be higher than either alone
    expect(resultWithBoost.score).toBeGreaterThan(resultNoBoost.score);
    expect(resultWithBoost.score).toBeGreaterThan(0.3);
  });
});

describe('extractXmlText', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-xml-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts element names from XML', async () => {
    const xml = '<HoaDon><MaSoThue>123</MaSoThue></HoaDon>';
    const file = path.join(tmpDir, 'test.xml');
    fs.writeFileSync(file, xml);

    const text = await extractXmlText(file);
    expect(text).toContain('HoaDon');
    expect(text).toContain('MaSoThue');
  });
});
