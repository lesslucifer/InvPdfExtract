import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FileStatus } from '../shared/types';
import { StatusDot } from './StatusDot';
import { Icons, ICON_SIZE } from '../shared/icons';

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
  onOpenFile?: (relativePath: string) => void;
  onOpenFolder?: (relativePath: string) => void;
}

export const PathResultsList: React.FC<Props> = ({ query, scope, onSelectFolder, onSelectFile, onReprocessFile, onReprocessFolder, onOpenFile, onOpenFolder }) => {
  const [items, setItems] = useState<PathItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const [itemStatuses, setItemStatuses] = useState<Record<string, FileStatus>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshStatuses = useCallback(async (currentItems: PathItem[]) => {
    const filePaths = currentItems.filter(r => !r.isDir).map(r => r.relativePath);
    const [fileStatuses, folderStatuses] = await Promise.all([
      filePaths.length > 0 ? window.api.getFileStatusesByPaths(filePaths) : Promise.resolve({}),
      window.api.getFolderStatuses(),
    ]);
    setItemStatuses({ ...folderStatuses, ...fileStatuses });
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await window.api.listVaultPaths(query, scope ?? undefined);
        setItems(results);
        setSelectedIndex(0);
        await refreshStatuses(results);
      } catch {
        setItems([]);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, scope, refreshStatuses]);

  // Re-fetch statuses when file processing status changes
  useEffect(() => {
    const unsubscribe = window.api.onFileStatusChanged(() => {
      refreshStatuses(items);
    });
    return unsubscribe;
  }, [items, refreshStatuses]);

  const handleSelect = useCallback((item: PathItem, e?: React.MouseEvent | KeyboardEvent) => {
    const metaOrCtrl = e && ('metaKey' in e) && (e.metaKey || e.ctrlKey);
    const alt = e && ('altKey' in e) && e.altKey;

    if (metaOrCtrl) {
      // Cmd/Ctrl+click → open in Finder
      if (item.isDir) {
        onOpenFolder?.(item.relativePath);
      } else {
        onOpenFile?.(item.relativePath);
      }
    } else if (alt) {
      // Alt/Option+click → reprocess
      if (item.isDir) {
        onReprocessFolder?.(item.relativePath);
      } else {
        onReprocessFile?.(item.relativePath);
      }
    } else {
      // Normal click → set scope
      if (item.isDir) {
        onSelectFolder(item.relativePath);
      } else {
        onSelectFile(item.relativePath);
      }
    }
  }, [onSelectFolder, onSelectFile, onOpenFile, onOpenFolder, onReprocessFile, onReprocessFolder]);

  const setOptimisticStatus = useCallback((item: PathItem) => {
    const key = item.isDir ? item.name : item.relativePath;
    setItemStatuses(prev => ({ ...prev, [key]: FileStatus.Pending }));
  }, []);

  const handleReprocess = useCallback(async (e: React.MouseEvent, item: PathItem) => {
    e.stopPropagation();
    if (item.isDir) {
      if (!onReprocessFolder) return;
      try {
        const { count } = await window.api.countFolderFiles(item.relativePath);
        if (count > CONFIRM_THRESHOLD) {
          setConfirmPath(item.relativePath);
        } else {
          setOptimisticStatus(item);
          onReprocessFolder(item.relativePath);
        }
      } catch {
        setOptimisticStatus(item);
        onReprocessFolder(item.relativePath);
      }
    } else {
      setOptimisticStatus(item);
      onReprocessFile?.(item.relativePath);
    }
  }, [onReprocessFile, onReprocessFolder, setOptimisticStatus]);

  const handleConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmPath) {
      const matchedItem = items.find(i => i.relativePath === confirmPath);
      if (matchedItem) {
        setItemStatuses(prev => ({ ...prev, [matchedItem.name]: FileStatus.Pending }));
      }
      onReprocessFolder?.(confirmPath);
    }
    setConfirmPath(null);
  }, [confirmPath, onReprocessFolder, items]);

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
          handleSelect(items[selectedIndex], e);
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
            onClick={(e) => handleSelect(item, e)}
            onMouseEnter={() => setSelectedIndex(idx)}
          >
            <span className="path-results-icon">{item.isDir ? <Icons.folder size={ICON_SIZE.MD} /> : <Icons.file size={ICON_SIZE.MD} />}</span>
            {itemStatuses[item.isDir ? item.name : item.relativePath] && (
              <StatusDot status={itemStatuses[item.isDir ? item.name : item.relativePath]} />
            )}
            <span className="path-results-name">{item.name}</span>
            <span className="path-results-path">{item.relativePath}</span>
            {showReload && (
              <button
                className="path-reload-btn"
                title={item.isDir ? `Reprocess all files in ${item.relativePath}` : 'Reprocess this file'}
                onClick={(e) => handleReprocess(e, item)}
              ><Icons.refresh size={ICON_SIZE.SM} /></button>
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
