import * as path from 'path';
import { FilterResult, RelevanceFilterConfig } from '../../shared/types';
import { RELEVANT_PATH_PATTERNS, RELEVANT_FILENAME_PATTERNS } from './keyword-bank';

export function filenameFilter(
  relativePath: string,
  fileSize: number,
  config: RelevanceFilterConfig
): FilterResult {
  const filename = path.basename(relativePath).toLowerCase();
  const filenameNoExt = path.basename(relativePath, path.extname(relativePath)).toLowerCase();
  const dirParts = path.dirname(relativePath).toLowerCase().split(path.sep);
  const fullLower = relativePath.toLowerCase();

  // Suppress unused var lint — filename used for keyword check below
  void filename;

  let score = 0;
  const reasons: string[] = [];

  const allPathPatterns = [...RELEVANT_PATH_PATTERNS, ...config.customPathPatterns];
  for (const pattern of allPathPatterns) {
    const lower = pattern.toLowerCase();
    if (dirParts.some(d => d.includes(lower)) || fullLower.includes(lower)) {
      score += 0.3;
      reasons.push(`Path matches: "${pattern}"`);
      break;
    }
  }

  for (const regex of RELEVANT_FILENAME_PATTERNS) {
    if (regex.test(filenameNoExt)) {
      score += 0.35;
      reasons.push(`Filename matches pattern: ${regex.source}`);
      break;
    }
  }

  const filenameKeywords = [
    'hoadon', 'hoa_don', 'hodon', 'invoice', 'inv',
    'saoke', 'sao_ke', 'statement', 'bank',
    'bangke', 'bang_ke', 'receipt', 'payment',
    'GTGT', 'gtgt', 'thue', 'tax', 'vat',
    'TaxID', 'taxId', 'chungtu', 'chung_tu',
    'phieuthu', 'phieu_thu', 'phieuchi', 'phieu_chi',
  ];
  for (const kw of filenameKeywords) {
    if (filenameNoExt.includes(kw.toLowerCase())) {
      score += 0.4;
      reasons.push(`Filename contains keyword: "${kw}"`);
      break;
    }
  }

  if (fileSize > 0) {
    if (fileSize < config.sizeMinBytes) {
      score -= config.sizePenalty;
      reasons.push(`File too small (${fileSize} bytes < ${config.sizeMinBytes})`);
    } else if (fileSize > config.sizeMaxBytes) {
      score -= config.sizePenalty;
      reasons.push(`File too large (${fileSize} bytes > ${config.sizeMaxBytes})`);
    }
  }

  score = Math.max(0, Math.min(1, score));

  const decision = score > config.processThreshold
    ? 'process' as const
    : 'uncertain' as const;

  return {
    score,
    reason: reasons.length > 0 ? reasons.join('; ') : 'No filename/path signals detected',
    layer: 1,
    decision,
  };
}
