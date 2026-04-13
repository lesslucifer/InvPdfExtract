import { fork } from 'child_process';
import * as path from 'path';
import { ExtractionFileResult } from '../shared/types';
import { findNodeModules } from './app-paths';
import { log, LogModule } from './logger';

export interface ExecuteScriptOptions {
  timeoutMs?: number;
  cwd?: string;
  modulePaths?: string[];
}

/**
 * Executes a parser script in a child process and captures JSON output.
 * The script receives the filePath as process.argv[2] and must output
 * a JSON ExtractionFileResult to stdout.
 */
export function executeScript(
  scriptPath: string,
  filePath: string,
  options: ExecuteScriptOptions = {},
): Promise<ExtractionFileResult> {
  const timeoutMs = options.timeoutMs ?? 30000;
  log.debug(LogModule.Script, `Executing script: ${path.basename(scriptPath)}`, { filePath: path.basename(filePath), timeoutMs });

  return new Promise((resolve, reject) => {
    const modulePaths = options.modulePaths ?? findNodeModules();
    const env = modulePaths.length > 0
      ? { ...process.env, NODE_PATH: modulePaths.join(path.delimiter) }
      : process.env;

    const child = fork(scriptPath, [filePath], {
      silent: true,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      cwd: options.cwd,
      env,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      log.error(LogModule.Script, `Script process error`, err);
      reject(err);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        log.error(LogModule.Script, `Script timed out after ${timeoutMs}ms`, { scriptPath: path.basename(scriptPath) });
        reject(new Error(`Script execution timeout after ${timeoutMs}ms`));
        return;
      }

      if (code !== 0) {
        log.error(LogModule.Script, `Script exited with code ${code}`, { stderr: stderr.substring(0, 500) });
        reject(new Error(`Script exited with code ${code}: ${stderr}`));
        return;
      }

      // Parse the last line of stdout as JSON (scripts may log debug info before)
      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(new Error('Script produced no JSON output'));
        return;
      }

      try {
        const result = JSON.parse(trimmed);
        log.debug(LogModule.Script, `Script completed: ${result.records?.length ?? 0} records`, { scriptPath: path.basename(scriptPath) });
        resolve(result);
      } catch {
        log.error(LogModule.Script, `Script output not valid JSON`, { output: trimmed.substring(0, 200) });
        reject(new Error(`Script output is not valid JSON: ${trimmed.substring(0, 200)}`));
      }
    });
  });
}
