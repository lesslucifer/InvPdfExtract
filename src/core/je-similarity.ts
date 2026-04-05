import dice = require('fast-dice-coefficient');
import { eventBus } from './event-bus';
import { getRecentClassifiedLineItems, getRecentClassifiedBankItems, CacheEntry } from './db/journal-entries';
import { JE_SIMILARITY_THRESHOLD, JE_SIMILARITY_CACHE_SIZE } from '../shared/constants';

interface NormalizedCacheEntry extends CacheEntry {
  normalizedMoTa: string;
}

export interface SimilarityMatch {
  tkNo: string;
  tkCo: string;
  cashFlow: string | null;
  entryType: string;
  score: number;
  matchedDescription: string;
}

export class JESimilarityEngine {
  private cache: NormalizedCacheEntry[] = [];
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
    this.refresh();

    // Subscribe to events for cache refresh
    const onExtraction = () => this.scheduleRefresh();
    const onJeGenerated = () => this.scheduleRefresh();
    const onJeUpdated = () => this.scheduleRefresh();

    eventBus.on('extraction:completed', onExtraction);
    eventBus.on('je:generated', onJeGenerated);
    eventBus.on('je:updated', onJeUpdated);

    // Store unsubscribe functions
    this.listeners = [
      () => eventBus.off('extraction:completed', onExtraction),
      () => eventBus.off('je:generated', onJeGenerated),
      () => eventBus.off('je:updated', onJeUpdated),
    ];
  }

  refresh(): void {
    try {
      const lineItems = getRecentClassifiedLineItems(this.maxSize);
      const bankItems = getRecentClassifiedBankItems(Math.min(1000, this.maxSize));

      this.cache = [...lineItems, ...bankItems]
        .slice(0, this.maxSize)
        .map(entry => ({
          ...entry,
          normalizedMoTa: normalize(entry.mo_ta),
        }))
        .filter(entry => entry.normalizedMoTa.length > 0);

      console.log(`[JESimilarity] Cache refreshed: ${this.cache.length} entries`);
    } catch (err) {
      console.error('[JESimilarity] Cache refresh failed:', err);
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refresh();
    }, 2000);
  }

  findMatch(moTa: string): SimilarityMatch | null {
    const normalized = normalize(moTa);
    if (normalized.length < 2) return null; // dice needs at least 2 chars

    let bestMatch: NormalizedCacheEntry | null = null;
    let bestScore = 0;

    for (const entry of this.cache) {
      const score = dice(normalized, entry.normalizedMoTa);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = entry;
        if (score === 1.0) break; // exact match, no need to continue
      }
    }

    if (bestMatch && bestScore >= this.threshold) {
      return {
        tkNo: bestMatch.tk_no,
        tkCo: bestMatch.tk_co,
        cashFlow: bestMatch.cash_flow,
        entryType: bestMatch.entry_type,
        score: bestScore,
        matchedDescription: bestMatch.mo_ta,
      };
    }

    return null;
  }

  getCacheSize(): number {
    return this.cache.length;
  }

  destroy(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    for (const unsub of this.listeners) {
      unsub();
    }
    this.listeners = [];
    this.cache = [];
    this.initialized = false;
  }
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}
