import { fork } from 'child_process';
import { ExtractionFileResult } from '../shared/types';

export interface ExecuteScriptOptions {
  timeoutMs?: number;
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

  return new Promise((resolve, reject) => {
    const child = fork(scriptPath, [filePath], {
      silent: true,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
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
      reject(err);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(new Error(`Script execution timeout after ${timeoutMs}ms`));
        return;
      }

      if (code !== 0) {
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
        resolve(result);
      } catch {
        reject(new Error(`Script output is not valid JSON: ${trimmed.substring(0, 200)}`));
      }
    });
  });
}
