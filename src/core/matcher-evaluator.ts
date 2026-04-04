import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { ExtractionScript } from '../shared/types';

export interface MatcherEvaluatorOptions {
  matcherTimeoutMs?: number;
}

/**
 * Evaluates cached matcher scripts against a file to find a matching parser.
 * Matchers are CommonJS modules that export a function(filePath) => boolean.
 *
 * Scripts are executed in a Node vm sandbox to avoid webpack's __webpack_require__
 * transforming dynamic require() calls. The sandbox provides a real require()
 * via createRequire so matcher scripts can load dependencies like 'xlsx'.
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
    const code = fs.readFileSync(matcherPath, 'utf-8');

    // Create a real require() anchored at the matcher's directory
    // so it can resolve 'xlsx' and other dependencies from node_modules.
    const matcherRequire = createRequire(matcherPath);

    const moduleExports: { exports: unknown } = { exports: {} };

    const sandbox = {
      require: matcherRequire,
      module: moduleExports,
      exports: moduleExports.exports,
      __filename: matcherPath,
      __dirname: path.dirname(matcherPath),
      console,
      process,
      Buffer,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    };

    const timeoutMs = this.matcherTimeoutMs;

    // Wrap the matcher code so that both module evaluation AND the matcher
    // function call run inside the same vm context with a single timeout.
    // vm.Script timeout covers all execution within runInNewContext.
    const wrappedCode = `
      ${code}
      ;(function() {
        var fn = module.exports;
        if (typeof fn !== 'function') {
          throw new Error('Matcher at ${matcherPath.replace(/'/g, "\\'")} does not export a function');
        }
        return fn(${JSON.stringify(filePath)});
      })();
    `;

    const script = new vm.Script(wrappedCode, { filename: matcherPath });
    const result = script.runInNewContext(sandbox, { timeout: timeoutMs });

    return !!result;
  }
}
