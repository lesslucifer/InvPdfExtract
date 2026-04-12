import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import { ExtractionScript } from '../shared/types';
import { findNodeModules } from './app-paths';

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
    const fileName = path.basename(filePath);
    console.log(`[MatcherEvaluator] Testing ${fileName} against ${scripts.length} cached script(s)`);
    for (const script of scripts) {
      try {
        const absoluteMatcherPath = path.resolve(vaultDotPath, script.matcher_path);
        const t0 = performance.now();
        const matched = this.runMatcher(absoluteMatcherPath, filePath);
        console.log(`[MatcherEvaluator]   "${script.name}" (${script.doc_type}, used ${script.times_used}x) → ${matched ? 'MATCH' : 'no match'} [${(performance.now() - t0).toFixed(0)}ms]`);
        if (matched) return script;
      } catch (err) {
        console.warn(`[MatcherEvaluator]   "${script.name}" → ERROR: ${(err as Error).message}`);
      }
    }
    console.log(`[MatcherEvaluator] No matching script found for ${fileName}`);
    return null;
  }

  private runMatcher(matcherPath: string, filePath: string): boolean {
    const code = fs.readFileSync(matcherPath, 'utf-8');

    // Create a real require() anchored at the matcher's directory,
    // with fallback to the app's node_modules for dependencies like 'xlsx'.
    const baseRequire = createRequire(matcherPath);
    const appModulePaths = findNodeModules();
    const appRequires = appModulePaths.map(p => createRequire(path.join(p, '_')));
    const matcherRequire = (id: string) => {
      try {
        return baseRequire(id);
      } catch {
        for (const fallback of appRequires) {
          try { return fallback(id); } catch { /* try next */ }
        }
        throw new Error(`Cannot find module '${id}'`);
      }
    };
    matcherRequire.resolve = baseRequire.resolve;
    matcherRequire.cache = baseRequire.cache;

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
