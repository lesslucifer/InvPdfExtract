import dice = require('fast-dice-coefficient');
import { eventBus } from './event-bus';
import { getRecentClassifiedLineItems, getRecentClassifiedBankItems, CacheEntry } from './db/journal-entries';
import { JE_SIMILARITY_THRESHOLD, JE_SIMILARITY_CACHE_SIZE } from '../shared/constants';
import { log, LogModule } from './logger';

interface NormalizedCacheEntry extends CacheEntry {
  normalizedMoTa: string;
}

export interface SimilarityMatch {
  account: string;
  contraAccount: string | null;
  cashFlow: string | null;
  entryType: string;
  score: number;
  matchedDescription: string;
}

export class JESimilarityEngine {
  private cache: NormalizedCacheEntry[] = [];
  private bigramIndex: Map<number, number[]> = new Map();
  private entryBigramCounts: number[] = [];
  private entryLengths: number[] = [];
  private threshold: number;
  private maxSize: number;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  private listeners: Array<() => void> = [];

  constructor(threshold?: number, maxSize?: number) {
    this.threshold = threshold ?? JE_SIMILARITY_THRESHOLD;
    this.maxSize = maxSize ?? JE_SIMILARITY_CACHE_SIZE;
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    log.info(LogModule.Similarity, `Initializing similarity engine (threshold=${this.threshold})`);
    this.refresh();

    const onExtraction = () => this.scheduleRefresh();
    const onJeGenerated = () => this.scheduleRefresh();
    const onJeUpdated = () => this.scheduleRefresh();

    eventBus.on('extraction:completed', onExtraction);
    eventBus.on('je:generated', onJeGenerated);
    eventBus.on('je:updated', onJeUpdated);

    this.listeners = [
      () => eventBus.off('extraction:completed', onExtraction),
      () => eventBus.off('je:generated', onJeGenerated),
      () => eventBus.off('je:updated', onJeUpdated),
    ];
  }

  refresh(): void {
    try {
      const t0 = performance.now();
      const lineItems = getRecentClassifiedLineItems(this.maxSize);
      const t1 = performance.now();
      const bankItems = getRecentClassifiedBankItems(Math.min(1000, this.maxSize));
      const t2 = performance.now();

      const rawEntries = [...lineItems, ...bankItems]
        .slice(0, this.maxSize)
        .map(entry => ({
          ...entry,
          normalizedMoTa: normalize(entry.description),
        }))
        .filter(entry => entry.normalizedMoTa.length > 0);

      // Deduplicate by normalized description — keep first (most recent) per unique description
      const seen = new Set<string>();
      this.cache = rawEntries.filter(entry => {
        if (seen.has(entry.normalizedMoTa)) return false;
        seen.add(entry.normalizedMoTa);
        return true;
      });

      this.rebuildBigramIndex();

      const t3 = performance.now();
      log.info(LogModule.Similarity, `Cache refreshed: ${this.cache.length} unique entries (${rawEntries.length} before dedup, lineItemQuery=${(t1 - t0).toFixed(0)}ms, bankQuery=${(t2 - t1).toFixed(0)}ms, normalize+index=${(t3 - t2).toFixed(0)}ms, total=${(t3 - t0).toFixed(0)}ms)`);
    } catch (err) {
      log.error(LogModule.Similarity, 'Cache refresh failed:', err);
    }
  }

  /** Refresh immediately, bypassing the debounce timer. Use between AI batch flushes. */
  refreshNow(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.refresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refresh();
    }, 2000);
  }

  private rebuildBigramIndex(): void {
    this.bigramIndex = new Map();
    this.entryBigramCounts = new Array(this.cache.length);
    this.entryLengths = new Array(this.cache.length);
    for (let j = 0; j < this.cache.length; j++) {
      const s = this.cache[j].normalizedMoTa;
      this.entryLengths[j] = s.length;
      const bigrams = getBigrams(s);
      this.entryBigramCounts[j] = bigrams.size;
      for (const bg of bigrams) {
        let list = this.bigramIndex.get(bg);
        if (!list) {
          list = [];
          this.bigramIndex.set(bg, list);
        }
        list.push(j);
      }
    }
  }

  private _findMatchCallCount = 0;
  private _findMatchTotalMs = 0;

  findMatch(moTa: string): SimilarityMatch | null {
    const t0 = performance.now();
    const normalized = normalize(moTa);
    if (normalized.length < 2) return null;

    const match = this.findBestMatch(normalized);

    this._findMatchCallCount++;
    this._findMatchTotalMs += performance.now() - t0;

    return match;
  }

  /**
   * Batch similarity matching. Returns a Map from input index
   * to the best SimilarityMatch (only entries that met the threshold).
   */
  async findMatchBatch(descriptions: string[]): Promise<Map<number, SimilarityMatch>> {
    if (descriptions.length === 0) return new Map();

    const t0 = performance.now();
    const results = new Map<number, SimilarityMatch>();

    for (let i = 0; i < descriptions.length; i++) {
      const normalized = normalize(descriptions[i]);
      if (normalized.length < 2) continue;
      const match = this.findBestMatch(normalized);
      if (match) results.set(i, match);
    }

    log.debug(LogModule.Similarity, `findMatchBatch: ${descriptions.length} items, ${results.size} matches, ${(performance.now() - t0).toFixed(0)}ms`);
    return results;
  }

  private findBestMatch(normalized: string): SimilarityMatch | null {
    const qStrLen = normalized.length;
    const lenRatioLo = this.threshold / (2 - this.threshold);
    const lenRatioHi = (2 - this.threshold) / this.threshold;
    const minLen = Math.ceil(qStrLen * lenRatioLo);
    const maxLen = Math.floor(qStrLen * lenRatioHi);

    const queryBigrams = getBigrams(normalized);
    const qLen = queryBigrams.size;
    if (qLen === 0) return null;

    // Count shared bigrams per candidate via the inverted index
    // Skip entries whose string length is outside the Dice-feasible range
    const hitCounts = new Map<number, number>();
    for (const bg of queryBigrams) {
      const list = this.bigramIndex.get(bg);
      if (!list) continue;
      for (let k = 0; k < list.length; k++) {
        const idx = list[k];
        const eLen = this.entryLengths[idx];
        if (eLen < minLen || eLen > maxLen) continue;
        hitCounts.set(idx, (hitCounts.get(idx) || 0) + 1);
      }
    }

    let bestMatch: NormalizedCacheEntry | null = null;
    let bestScore = 0;

    for (const [j, shared] of hitCounts) {
      const cLen = this.entryBigramCounts[j];
      const minShared = this.threshold * (qLen + cLen) / 2;
      if (shared < minShared) continue;

      const score = dice(normalized, this.cache[j].normalizedMoTa);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = this.cache[j];
        if (score === 1.0) break;
      }
    }

    if (bestMatch && bestScore >= this.threshold) {
      return {
        account: bestMatch.account,
        contraAccount: bestMatch.contra_account ?? null,
        cashFlow: bestMatch.cash_flow,
        entryType: bestMatch.entry_type,
        score: bestScore,
        matchedDescription: bestMatch.description,
      };
    }

    return null;
  }

  resetPerfCounters(): void {
    this._findMatchCallCount = 0;
    this._findMatchTotalMs = 0;
  }

  logPerfCounters(label: string): void {
    if (this._findMatchCallCount > 0) {
      log.info(LogModule.Similarity, `${label}: findMatch called ${this._findMatchCallCount}x, total=${this._findMatchTotalMs.toFixed(0)}ms, avg=${(this._findMatchTotalMs / this._findMatchCallCount).toFixed(2)}ms, cacheSize=${this.cache.length}`);
    }
  }

  getCacheSize(): number {
    return this.cache.length;
  }

  destroy(): void {
    log.info(LogModule.Similarity, `Destroying similarity engine (cacheSize=${this.cache.length})`);
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    for (const unsub of this.listeners) {
      unsub();
    }
    this.listeners = [];
    this.cache = [];
    this.bigramIndex = new Map();
    this.entryBigramCounts = [];
    this.entryLengths = [];
    this.initialized = false;
  }
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function getBigrams(s: string): Set<number> {
  const bigrams = new Set<number>();
  for (let i = 0; i < s.length - 1; i++) {
    bigrams.add(s.charCodeAt(i) * 65536 + s.charCodeAt(i + 1));
  }
  return bigrams;
}
