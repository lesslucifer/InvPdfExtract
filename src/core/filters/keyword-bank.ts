import Fuse from 'fuse.js';
import { FilterKeyword, RelevanceFilterConfig } from '../../shared/types';

export const BUILTIN_KEYWORDS: FilterKeyword[] = [
  // Vietnamese invoice terms (high confidence)
  { term: 'hoa don', weight: 0.8, category: 'invoice' },
  { term: 'hoa don GTGT', weight: 0.95, category: 'invoice' },
  { term: 'GTGT', weight: 0.9, category: 'invoice' },
  { term: 'hoa don dau ra', weight: 0.9, category: 'invoice' },
  { term: 'hoa don dau vao', weight: 0.9, category: 'invoice' },
  { term: 'TaxID', weight: 0.7, category: 'invoice' },
  { term: 'ma so thue', weight: 0.85, category: 'invoice' },
  { term: 'so hoa don', weight: 0.85, category: 'invoice' },
  { term: 'tong tien', weight: 0.6, category: 'general_accounting' },
  { term: 'tong tien truoc thue', weight: 0.75, category: 'invoice' },
  { term: 'thue suat', weight: 0.8, category: 'invoice' },
  { term: 'NCC', weight: 0.6, category: 'invoice' },
  { term: 'nha cung cap', weight: 0.7, category: 'invoice' },
  { term: 'KH', weight: 0.4, category: 'invoice' },
  { term: 'khach hang', weight: 0.6, category: 'invoice' },
  { term: 'cong no', weight: 0.7, category: 'general_accounting' },
  { term: 'phieu thu', weight: 0.75, category: 'general_accounting' },
  { term: 'phieu chi', weight: 0.75, category: 'general_accounting' },
  { term: 'uy nhiem chi', weight: 0.8, category: 'bank_statement' },
  { term: 'giay bao no', weight: 0.8, category: 'bank_statement' },
  { term: 'giay bao co', weight: 0.8, category: 'bank_statement' },

  // Vietnamese bank statement terms
  { term: 'sao ke', weight: 0.85, category: 'bank_statement' },
  { term: 'sao ke ngan hang', weight: 0.95, category: 'bank_statement' },
  { term: 'ngan hang', weight: 0.6, category: 'bank_statement' },
  { term: 'so du', weight: 0.5, category: 'bank_statement' },
  { term: 'giao dich', weight: 0.5, category: 'bank_statement' },
  { term: 'chuyen khoan', weight: 0.65, category: 'bank_statement' },
  { term: 'tai khoan', weight: 0.5, category: 'bank_statement' },

  // General Vietnamese accounting
  { term: 'ke toan', weight: 0.7, category: 'general_accounting' },
  { term: 'chung tu', weight: 0.75, category: 'general_accounting' },
  { term: 'so cai', weight: 0.7, category: 'general_accounting' },
  { term: 'bang ke', weight: 0.7, category: 'general_accounting' },
  { term: 'chi tiet', weight: 0.4, category: 'general_accounting' },
  { term: 'don gia', weight: 0.65, category: 'invoice' },
  { term: 'so luong', weight: 0.4, category: 'invoice' },
  { term: 'thanh tien', weight: 0.65, category: 'invoice' },
  { term: 'dia chi', weight: 0.3, category: 'general_accounting' },

  // English/common terms
  { term: 'invoice', weight: 0.8, category: 'invoice' },
  { term: 'inv', weight: 0.5, category: 'invoice' },
  { term: 'bank statement', weight: 0.85, category: 'bank_statement' },
  { term: 'bank', weight: 0.4, category: 'bank_statement' },
  { term: 'statement', weight: 0.5, category: 'bank_statement' },
  { term: 'receipt', weight: 0.6, category: 'general_accounting' },
  { term: 'payment', weight: 0.5, category: 'general_accounting' },
  { term: 'billing', weight: 0.6, category: 'invoice' },
  { term: 'tax', weight: 0.5, category: 'general_accounting' },
  { term: 'VAT', weight: 0.7, category: 'invoice' },
  { term: 'debit', weight: 0.5, category: 'bank_statement' },
  { term: 'credit', weight: 0.5, category: 'bank_statement' },
  { term: 'total', weight: 0.3, category: 'general_accounting' },
  { term: 'amount', weight: 0.3, category: 'general_accounting' },
  { term: 'subtotal', weight: 0.4, category: 'invoice' },
];

export const RELEVANT_PATH_PATTERNS: string[] = [
  'ke_toan', 'ketoan', 'accounting',
  'invoices', 'invoice', 'hoa_don', 'hoadon',
  'bank', 'ngan_hang', 'nganh hang', 'sao_ke', 'saoke',
  'bang_ke', 'bangke',
  'chung_tu', 'chungtu',
  'thue', 'tax', 'vat', 'GTGT',
  'dau_ra', 'daura', 'dau_vao', 'dauvao',
  'NCC', 'KH',
  'phieu_thu', 'phieu_chi',
  'cong_no', 'congno',
];

export const RELEVANT_FILENAME_PATTERNS: RegExp[] = [
  /\bHD\d{4,}/i,
  /\b\d{7,}\b/,
  /\b[A-Z]{1,3}\/\d{2}[A-Z]-\d+/i,
  /\b20\d{2}[-_]?\d{2}[-_]?\d{2}\b/,
  /\b\d{2}[-_]20\d{2}\b/,
  /\binv[_-]?\d+/i,
  /\breceipt[_-]?\d+/i,
  /\bpayment[_-]?\d+/i,
];

export function getMergedKeywords(config: RelevanceFilterConfig): FilterKeyword[] {
  const merged = [...BUILTIN_KEYWORDS];
  for (const custom of config.customKeywords) {
    const existingIdx = merged.findIndex(k => k.term.toLowerCase() === custom.term.toLowerCase());
    if (existingIdx >= 0) {
      merged[existingIdx] = custom;
    } else {
      merged.push(custom);
    }
  }
  return merged;
}

export function createKeywordMatcher(keywords: FilterKeyword[]): (text: string) => { score: number; matchedTerms: Array<{ term: string; weight: number; fuseScore: number }> } {
  const fuse = new Fuse(keywords, {
    keys: ['term'],
    threshold: 0.4,
    includeScore: true,
    ignoreLocation: true,
    findAllMatches: true,
  });

  return (text: string) => {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalized) return { score: 0, matchedTerms: [] };
    const words = normalized.split(/\s+/);
    const matchedTerms: Array<{ term: string; weight: number; fuseScore: number }> = [];
    const seenTerms = new Set<string>();

    for (const keyword of keywords) {
      const termWords = keyword.term.toLowerCase().split(/\s+/);
      const windowSize = termWords.length;

      for (let i = 0; i <= words.length - windowSize; i++) {
        const window = words.slice(i, i + windowSize).join(' ');
        const results = fuse.search(window);

        for (const result of results) {
          if (result.item.term.toLowerCase() === keyword.term.toLowerCase() && !seenTerms.has(keyword.term)) {
            seenTerms.add(keyword.term);
            matchedTerms.push({
              term: keyword.term,
              weight: keyword.weight,
              fuseScore: result.score ?? 0,
            });
          }
        }
      }
    }

    // Exact substring fallback
    for (const keyword of keywords) {
      const lower = keyword.term.toLowerCase();
      if (!seenTerms.has(keyword.term) && normalized.includes(lower)) {
        seenTerms.add(keyword.term);
        matchedTerms.push({
          term: keyword.term,
          weight: keyword.weight,
          fuseScore: 0,
        });
      }
    }

    if (matchedTerms.length === 0) return { score: 0, matchedTerms: [] };

    let complementProduct = 1;
    for (const match of matchedTerms) {
      const contribution = match.weight * (1 - match.fuseScore);
      complementProduct *= (1 - contribution);
    }
    const score = Math.min(1, 1 - complementProduct);

    return { score, matchedTerms };
  };
}
