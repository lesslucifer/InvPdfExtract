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
   */
  findMatchingScript(filePath: string, scripts: ExtractionScript[]): ExtractionScript | null {
    for (const script of scripts) {
      try {
        const matched = this.runMatcher(script.matcher_path, filePath);
        if (matched) return script;
      } catch (err) {
        console.warn(`[MatcherEvaluator] Matcher ${script.name} failed:`, err);
      }
    }
    return null;
  }

  private runMatcher(matcherPath: string, filePath: string): boolean {
    // Clear require cache so matchers can be updated
    delete require.cache[require.resolve(matcherPath)];

    // Use a sync timeout via busy-wait (matchers are sync functions)
    const startTime = Date.now();
    const timeoutMs = this.matcherTimeoutMs;

    // Set up a timeout check — we wrap the matcher call
    // Since matchers are sync, we can't truly interrupt them.
    // However, we can detect if they took too long after they return.
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
