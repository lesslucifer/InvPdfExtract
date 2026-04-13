import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initLogger, shutdownLogger, log, LogModule } from './logger';
import { LogLevel } from '../shared/types';
import { MAX_LOG_FILE_BYTES } from '../shared/constants';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logger-test-'));
});

afterEach(async () => {
  await shutdownLogger();
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('logger', () => {
  it('writes formatted log lines to app.log', async () => {
    await initLogger(tmpDir, { console: false });
    log.info(LogModule.Main, 'App started');
    await shutdownLogger();

    const content = await fs.promises.readFile(path.join(tmpDir, 'app.log'), 'utf-8');
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T.+\[INFO \] \[Main\] App started/);
  });

  it('includes detail on indented continuation line', async () => {
    await initLogger(tmpDir, { console: false });
    log.error(LogModule.ExtractionQueue, 'Failed', { code: 42 });
    await shutdownLogger();

    const content = await fs.promises.readFile(path.join(tmpDir, 'app.log'), 'utf-8');
    const lines = content.split('\n');
    expect(lines[0]).toContain('[ERROR] [ExtractionQueue] Failed');
    expect(lines[1]).toContain('"code":42');
  });

  it('serializes Error detail with message and stack', async () => {
    await initLogger(tmpDir, { console: false });
    log.error(LogModule.DB, 'Query failed', new Error('SQLITE_CONSTRAINT'));
    await shutdownLogger();

    const content = await fs.promises.readFile(path.join(tmpDir, 'app.log'), 'utf-8');
    expect(content).toContain('"message":"SQLITE_CONSTRAINT"');
    expect(content).toContain('"stack"');
  });

  it('respects log level gating', async () => {
    await initLogger(tmpDir, { console: false, level: LogLevel.Warn });
    log.debug(LogModule.Main, 'debug msg');
    log.info(LogModule.Main, 'info msg');
    log.warn(LogModule.Main, 'warn msg');
    log.error(LogModule.Main, 'error msg');
    await shutdownLogger();

    const content = await fs.promises.readFile(path.join(tmpDir, 'app.log'), 'utf-8');
    expect(content).not.toContain('debug msg');
    expect(content).not.toContain('info msg');
    expect(content).toContain('warn msg');
    expect(content).toContain('error msg');
  });

  it('buffers logs before init and flushes on init', async () => {
    log.info(LogModule.Main, 'pre-init message');
    await initLogger(tmpDir, { console: false });
    await shutdownLogger();

    const content = await fs.promises.readFile(path.join(tmpDir, 'app.log'), 'utf-8');
    expect(content).toContain('pre-init message');
  });

  it('rotates files when size threshold is exceeded', async () => {
    await initLogger(tmpDir, { console: false });

    const line = 'x'.repeat(200);
    const lineBytes = Buffer.byteLength(
      `2026-04-13T00:00:00.000Z [INFO ] [Main] ${line}\n`,
    );
    const linesNeeded = Math.ceil(MAX_LOG_FILE_BYTES / lineBytes) + 10;

    for (let i = 0; i < linesNeeded; i++) {
      log.info(LogModule.Main, line);
    }
    await shutdownLogger();

    const files = await fs.promises.readdir(tmpDir);
    const logFiles = files.filter((f) => f.startsWith('app'));
    expect(logFiles.length).toBeGreaterThan(1);
    expect(logFiles).toContain('app.1.log');
  });

  it('re-initializes to a different directory (vault switch)', async () => {
    await initLogger(tmpDir, { console: false });
    log.info(LogModule.Main, 'first vault');

    const tmpDir2 = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logger-test2-'));
    await initLogger(tmpDir2, { console: false });
    log.info(LogModule.Main, 'second vault');
    await shutdownLogger();

    const content1 = await fs.promises.readFile(path.join(tmpDir, 'app.log'), 'utf-8');
    expect(content1).toContain('first vault');
    expect(content1).not.toContain('second vault');

    const content2 = await fs.promises.readFile(path.join(tmpDir2, 'app.log'), 'utf-8');
    expect(content2).toContain('second vault');

    await fs.promises.rm(tmpDir2, { recursive: true, force: true });
  });
});
