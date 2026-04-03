import React, { useState, useEffect, useRef, useCallback } from 'react';

const CONFIRM_THRESHOLD = 10;

const DEBOUNCE_MS = 150;

interface PathItem {
  name: string;
  relativePath: string;
  isDir: boolean;
}

interface Props {
  /** Text after the leading '/' — pass '' for bare '/' (shows top-level dirs) */
  query: string;
  /** When set, results are limited to entries under this folder */
  scope?: string | null;
  onSelectFolder: (relativePath: string) => void;
  onSelectFile: (relativePath: string) => void;
  onReprocessFile?: (relativePath: string) => void;
  onReprocessFolder?: (folderPrefix: string) => void;
}

export const PathResultsList: React.FC<Props> = ({ query, scope, onSelectFolder, onSelectFile, onReprocessFile, onReprocessFolder }) => {
  const [items, setItems] = useState<PathItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await window.api.listVaultPaths(query, scope ?? undefined);
        setItems(results);
        setSelectedIndex(0);
      } catch {
        setItems([]);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, scope]);

  const handleSelect = useCallback((item: PathItem) => {
    if (item.isDir) {
      onSelectFolder(item.relativePath);
    } else {
      onSelectFile(item.relativePath);
    }
  }, [onSelectFolder, onSelectFile]);

  const handleReprocess = useCallback(async (e: React.MouseEvent, item: PathItem) => {
    e.stopPropagation();
    if (item.isDir) {
      if (!onReprocessFolder) return;
      try {
        const { count } = await window.api.countFolderFiles(item.relativePath);
        if (count > CONFIRM_THRESHOLD) {
          setConfirmPath(item.relativePath);
        } else {
          onReprocessFolder(item.relativePath);
        }
      } catch {
        onReprocessFolder(item.relativePath);
      }
    } else {
      onReprocessFile?.(item.relativePath);
    }
  }, [onReprocessFile, onReprocessFolder]);

  const handleConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmPath) onReprocessFolder?.(confirmPath);
    setConfirmPath(null);
  }, [confirmPath, onReprocessFolder]);

  const handleCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmPath(null);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[selectedIndex]) {
          handleSelect(items[selectedIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [items, selectedIndex, handleSelect]);

  if (items.length === 0) {
    return (
      <div className="path-results-empty">
        {query ? 'No matches' : 'No folders found'}
      </div>
    );
  }

  const showReload = onReprocessFile || onReprocessFolder;

  return (
    <>
      <ul className="path-results-list" role="listbox">
        {items.map((item, idx) => (
          <li
            key={item.relativePath}
            className={`path-results-item${idx === selectedIndex ? ' selected' : ''}`}
            role="option"
            aria-selected={idx === selectedIndex}
            onClick={() => handleSelect(item)}
            onMouseEnter={() => setSelectedIndex(idx)}
          >
            <span className="path-results-icon">{item.isDir ? '📁' : '📄'}</span>
            <span className="path-results-name">{item.name}</span>
            <span className="path-results-path">{item.relativePath}</span>
            {showReload && (
              <button
                className="path-reload-btn"
                title={item.isDir ? `Reprocess all files in ${item.relativePath}` : 'Reprocess this file'}
                onClick={(e) => handleReprocess(e, item)}
              >↻</button>
            )}
          </li>
        ))}
      </ul>
      {confirmPath && (
        <div className="result-confirm-bar" onClick={(e) => e.stopPropagation()}>
          <span>Reprocess all files in <strong>{confirmPath}</strong>?</span>
          <button className="result-confirm-yes" onClick={handleConfirm}>Yes</button>
          <button className="result-confirm-no" onClick={handleCancel}>Cancel</button>
        </div>
      )}
    </>
  );
};
