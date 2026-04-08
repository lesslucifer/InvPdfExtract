import { SearchResult } from '../shared/types';

export function replaceSearchResult(results: SearchResult[], updatedResult: SearchResult): SearchResult[] {
  return results.map(result => result.id === updatedResult.id ? updatedResult : result);
}
