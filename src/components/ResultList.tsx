import React, { useRef, useEffect } from 'react';
import { SearchResult } from '../shared/types';
import { ResultRow } from './ResultRow';
import { ResultDetail } from './ResultDetail';

interface Props {
  results: SearchResult[];
  selectedIndex: number;
  expandedId: string | null;
  onSelect: (index: number) => void;
  onToggleExpand: (id: string) => void;
  onOpenFile: (relativePath: string) => void;
  onFieldUpdated: () => void;
  onFolderClick?: (folder: string) => void;
  onDocTypeClick?: (docType: string) => void;
  onReprocessFile?: (relativePath: string) => void;
  onReprocessFolder?: (folderPrefix: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}

export const ResultList: React.FC<Props> = ({
  results, selectedIndex, expandedId, onSelect, onToggleExpand, onOpenFile, onFieldUpdated,
  onFolderClick, onDocTypeClick, onReprocessFile, onReprocessFolder,
  onLoadMore, hasMore, isLoadingMore,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const prevResultCountRef = useRef(results.length);

  // Scroll to top when results are replaced (fresh search)
  useEffect(() => {
    if (results.length < prevResultCountRef.current) {
      listRef.current?.scrollTo(0, 0);
    }
    prevResultCountRef.current = results.length;
  }, [results.length]);

  // Infinite scroll detection
  useEffect(() => {
    const el = listRef.current;
    if (!el || !onLoadMore) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight - scrollTop - clientHeight < 200 && hasMore && !isLoadingMore) {
        onLoadMore();
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [onLoadMore, hasMore, isLoadingMore]);

  if (results.length === 0) {
    return <div className="result-empty">No results found</div>;
  }

  return (
    <div className="result-list" role="listbox" ref={listRef}>
      {results.map((result, index) => (
        <div key={result.id}>
          <ResultRow
            result={result}
            isSelected={index === selectedIndex}
            isExpanded={expandedId === result.id}
            onClick={() => {
              onSelect(index);
              onToggleExpand(result.id);
            }}
            onFolderClick={onFolderClick}
            onDocTypeClick={onDocTypeClick}
            onOpenFile={onOpenFile}
            onReprocessFile={onReprocessFile}
            onReprocessFolder={onReprocessFolder}
          />
          {expandedId === result.id && (
            <ResultDetail
              result={result}
              onFieldUpdated={onFieldUpdated}
            />
          )}
        </div>
      ))}
      {isLoadingMore && (
        <div className="result-loading">Loading more...</div>
      )}
    </div>
  );
};
