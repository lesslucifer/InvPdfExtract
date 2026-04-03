import * as path from 'path';
import { ExtractionScript } from '../shared/types';

export interface MatcherEvaluatorOptions {
  matcherTimeoutMs?: number;
}

/**
 * Evaluates cached matcher scripts against a file to find a matching parser.
 * Matchers are CommonJS modules that export a function(filePath) => boolean.
 */
export class MatcherEvaluator {
  private matcherTimeoutMs: number;

  constructor(options: MatcherEvaluatorOptions = {}) {
    this.matcherTimeoutMs = options.matcherTimeoutMs ?? 5000;
  }

  /**
   * Finds the first script whose matcher returns true for the given file.
   * Skips matchers that throw or exceed the timeout.
   *
   * @param filePath - Absolute path to the file to test
   * @param scripts - Cached scripts from the registry
   * @param vaultDotPath - Absolute path to .invoicevault/ directory,
   *                       used to resolve relative matcher_path values
   */
  findMatchingScript(filePath: string, scripts: ExtractionScript[], vaultDotPath: string): ExtractionScript | null {
    for (const script of scripts) {
      try {
        const absoluteMatcherPath = path.resolve(vaultDotPath, script.matcher_path);
        const matched = this.runMatcher(absoluteMatcherPath, filePath);
        if (matched) return script;
      } catch (err) {
        console.warn(`[MatcherEvaluator] Matcher ${script.name} failed:`, (err as Error).message);
      }
    }
    return null;
  }

  private runMatcher(matcherPath: string, filePath: string): boolean {
    // Clear require cache so matchers can be updated
    try {
      delete require.cache[require.resolve(matcherPath)];
    } catch {
      // resolve may throw if not cached yet — that's fine
    }

    const startTime = Date.now();
    const timeoutMs = this.matcherTimeoutMs;

    const matcherFn = require(matcherPath);

    if (typeof matcherFn !== 'function') {
      throw new Error(`Matcher at ${matcherPath} does not export a function`);
    }

    const result = matcherFn(filePath);
    const elapsed = Date.now() - startTime;

    if (elapsed > timeoutMs) {
      console.warn(`[MatcherEvaluator] Matcher took ${elapsed}ms (timeout: ${timeoutMs}ms), skipping result`);
      return false;
    }

    return !!result;
  }
}
