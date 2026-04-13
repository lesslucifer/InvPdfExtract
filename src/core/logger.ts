import * as fs from 'fs';
import * as path from 'path';
import { LogLevel } from '../shared/types';
import { MAX_LOG_FILE_BYTES, MAX_ROTATED_LOG_FILES } from '../shared/constants';

export const LogModule = {
  Main: 'Main',
  ExtractionQueue: 'ExtractionQueue',
  JEGenerator: 'JEGenerator',
  SyncEngine: 'SyncEngine',
  Reconciler: 'Reconciler',
  Watcher: 'Watcher',
  Vault: 'Vault',
  ClaudeCLI: 'ClaudeCLI',
  DB: 'DB',
  IpcBridge: 'IpcBridge',
  Overlay: 'Overlay',
  Filter: 'Filter',
  Script: 'Script',
  Similarity: 'Similarity',
  Export: 'Export',
  Config: 'Config',
  Parser: 'Parser',
  Validator: 'Validator',
  Dedup: 'Dedup',
} as const;

const LEVEL_ORDER: Record<string, number> = {
  [LogLevel.Debug]: 0,
  [LogLevel.Info]: 1,
  [LogLevel.Warn]: 2,
  [LogLevel.Error]: 3,
};

const LEVEL_LABELS: Record<string, string> = {
  [LogLevel.Debug]: 'DEBUG',
  [LogLevel.Info]: 'INFO ',
  [LogLevel.Warn]: 'WARN ',
  [LogLevel.Error]: 'ERROR',
};

let logFile: string | null = null;
let bytesWritten = 0;
let enableConsole = true;
let minLevel: LogLevel = LogLevel.Debug;
let writeQueue: Promise<void> = Promise.resolve();
const preInitBuffer: string[] = [];

const PRE_INIT_BUFFER_MAX = 500;

function formatDetail(detail: unknown): string {
  if (detail instanceof Error) {
    return JSON.stringify({ message: detail.message, stack: detail.stack });
  }
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

export function formatLine(level: LogLevel, module: string, message: string, detail?: unknown): string {
  const timestamp = new Date().toISOString();
  const label = LEVEL_LABELS[level] ?? level.toUpperCase().padEnd(5);
  let line = `${timestamp} [${label}] [${module}] ${message}`;
  if (detail !== undefined) {
    line += `\n  ${formatDetail(detail)}`;
  }
  return line + '\n';
}

function writeToConsole(level: LogLevel, formattedLine: string): void {
  if (!enableConsole) return;
  const trimmed = formattedLine.trimEnd();
  if (level === LogLevel.Error) console.error(trimmed);
  else if (level === LogLevel.Warn) console.warn(trimmed);
  else console.log(trimmed);
}

async function rotateFiles(currentLogFile: string, logsDir: string): Promise<void> {
  for (let i = MAX_ROTATED_LOG_FILES; i >= 1; i--) {
    const from = i === 1
      ? currentLogFile
      : path.join(logsDir, `app.${i - 1}.log`);
    const to = path.join(logsDir, `app.${i}.log`);
    try {
      await fs.promises.rename(from, to);
    } catch {
      // File doesn't exist — skip
    }
  }
  bytesWritten = 0;
}

function enqueueWrite(line: string): void {
  if (!logFile) {
    if (preInitBuffer.length < PRE_INIT_BUFFER_MAX) {
      preInitBuffer.push(line);
    }
    return;
  }

  const currentFile = logFile;
  const logsDir = path.dirname(currentFile);

  writeQueue = writeQueue.then(async () => {
    await fs.promises.appendFile(currentFile, line);
    bytesWritten += Buffer.byteLength(line);
    if (bytesWritten >= MAX_LOG_FILE_BYTES) {
      await rotateFiles(currentFile, logsDir);
    }
  }).catch(() => {
    // Never let a write error crash the app
  });
}

function write(level: LogLevel, module: string, message: string, detail?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  const line = formatLine(level, module, message, detail);
  writeToConsole(level, line);
  enqueueWrite(line);
}

export async function initLogger(
  dir: string,
  options?: { console?: boolean; level?: LogLevel },
): Promise<void> {
  if (options?.console !== undefined) enableConsole = options.console;
  if (options?.level) minLevel = options.level;

  // Flush pending writes to the old file before switching
  await writeQueue;

  await fs.promises.mkdir(dir, { recursive: true });

  const newLogFile = path.join(dir, 'app.log');
  logFile = newLogFile;

  try {
    const stat = await fs.promises.stat(newLogFile);
    bytesWritten = stat.size;
  } catch {
    bytesWritten = 0;
  }

  // Flush pre-init buffer
  const buffered = preInitBuffer.splice(0);
  for (const line of buffered) {
    enqueueWrite(line);
  }
}

export async function shutdownLogger(): Promise<void> {
  await writeQueue;
  logFile = null;
  bytesWritten = 0;
  minLevel = LogLevel.Debug;
  enableConsole = true;
  preInitBuffer.length = 0;
}

export const log = {
  debug: (module: string, message: string, detail?: unknown) =>
    write(LogLevel.Debug, module, message, detail),
  info: (module: string, message: string, detail?: unknown) =>
    write(LogLevel.Info, module, message, detail),
  warn: (module: string, message: string, detail?: unknown) =>
    write(LogLevel.Warn, module, message, detail),
  error: (module: string, message: string, detail?: unknown) =>
    write(LogLevel.Error, module, message, detail),
};
