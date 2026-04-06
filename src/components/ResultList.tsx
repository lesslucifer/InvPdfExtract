import { t } from '../lib/i18n';
import React, { useRef, useEffect } from 'react';
import { ResultRow } from './ResultRow';
import { ResultDetail } from './ResultDetail';
import { useSearchStore } from '../stores';

interface Props {
  onOpenFile: (relativePath: string) => void;
  onOpenFolder?: (folder: string) => void;
  onReprocessFile?: (relativePath: string) => void;
  onReprocessFolder?: (folder: string) => void;
}

export const ResultList: React.FC<Props> = ({
  onOpenFile, onOpenFolder, onReprocessFile, onReprocessFolder,
}) => {
  const results = useSearchStore(s => s.results);
  const selectedIndex = useSearchStore(s => s.selectedIndex);
  const expandedId = useSearchStore(s => s.expandedId);
  const hasMore = useSearchStore(s => s.hasMore);
  const isLoadingMore = useSearchStore(s => s.isLoadingMore);

  const listRef = useRef<HTMLDivElement>(null);
  const prevResultCountRef = useRef(results.length);

  useEffect(() => {
    if (results.length < prevResultCountRef.current) {
      listRef.current?.scrollTo(0, 0);
    }
    prevResultCountRef.current = results.length;
  }, [results.length]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const ss = useSearchStore.getState();
      if (scrollHeight - scrollTop - clientHeight < 200 && ss.hasMore && !ss.isLoadingMore) {
        ss.loadMore();
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  if (results.length === 0) {
    return <div className="px-6 py-6 text-center text-text-muted">{t('no_results_found', 'No results found')}</div>;
  }

  return (
    <div className="result-list overflow-y-auto flex-1 min-h-0" role="listbox" ref={listRef}>
      {results.map((result, index) => (
        <div key={result.id}>
          <ResultRow
            result={result}
            isSelected={index === selectedIndex}
            isExpanded={expandedId === result.id}
            onClick={() => {
              useSearchStore.getState().setSelectedIndex(index);
              useSearchStore.getState().toggleExpand(result.id);
            }}
            onOpenFile={onOpenFile}
            onOpenFolder={onOpenFolder}
            onReprocessFile={onReprocessFile}
            onReprocessFolder={onReprocessFolder}
          />
          {expandedId === result.id && (
            <ResultDetail result={result} />
          )}
        </div>
      ))}
      {isLoadingMore && (
        <div className="text-center px-3 py-3 text-text-muted text-3.25">{`${t('loading_more', 'Loading more')}...`}</div>
      )}
    </div>
  );
};
