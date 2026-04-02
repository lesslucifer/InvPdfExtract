import React from 'react';
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
}

export const ResultList: React.FC<Props> = ({
  results, selectedIndex, expandedId, onSelect, onToggleExpand, onOpenFile, onFieldUpdated,
}) => {
  if (results.length === 0) {
    return <div className="result-empty">No results found</div>;
  }

  return (
    <div className="result-list" role="listbox">
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
          />
          {expandedId === result.id && (
            <ResultDetail
              result={result}
              onOpenFile={() => onOpenFile(result.relative_path)}
              onFieldUpdated={onFieldUpdated}
            />
          )}
        </div>
      ))}
    </div>
  );
};
