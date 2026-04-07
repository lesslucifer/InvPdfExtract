import { t } from '../lib/i18n';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FileStatus } from '../shared/types';
import { StatusIcon } from './StatusIcon';
import { Icons, ICON_SIZE } from '../shared/icons';
import { useFolderStatuses } from '../lib/queries';

const CONFIRM_THRESHOLD = 10;
const DEBOUNCE_MS = 150;

interface PathItem {
  name: string;
  relativePath: string;
  isDir: boolean;
}

interface Props {
  query: string;
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
  const [fileStatuses, setFileStatuses] = useState<Record<string, FileStatus>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: folderStatuses = {} } = useFolderStatuses();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await window.api.listVaultPaths(query, scope ?? undefined);
        setItems(results);
        setSelectedIndex(0);
        const filePaths = results.filter(r => !r.isDir).map(r => r.relativePath);
        const statuses = filePaths.length > 0 ? await window.api.getFileStatusesByPaths(filePaths) : {};
        setFileStatuses(statuses);
      } catch {
        setItems([]);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, scope]);

  const itemStatuses: Record<string, FileStatus> = { ...folderStatuses, ...fileStatuses };

  const handleSelect = useCallback((item: PathItem, e?: React.MouseEvent | KeyboardEvent) => {
    const metaOrCtrl = e && ('metaKey' in e) && (e.metaKey || e.ctrlKey);
    const alt = e && ('altKey' in e) && e.altKey;

    if (metaOrCtrl) {
      if (item.isDir) {
        onOpenFolder?.(item.relativePath);
      } else {
        onOpenFile?.(item.relativePath);
      }
    } else if (alt) {
      if (item.isDir) {
        onReprocessFolder?.(item.relativePath);
      } else {
        onReprocessFile?.(item.relativePath);
      }
    } else {
      if (item.isDir) {
        onSelectFolder(item.relativePath);
      } else {
        onSelectFile(item.relativePath);
      }
    }
  }, [onSelectFolder, onSelectFile, onOpenFile, onOpenFolder, onReprocessFile, onReprocessFolder]);

  const setOptimisticStatus = useCallback((item: PathItem) => {
    const key = item.isDir ? item.name : item.relativePath;
    setFileStatuses(prev => ({ ...prev, [key]: FileStatus.Pending }));
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
        setFileStatuses(prev => ({ ...prev, [matchedItem.name]: FileStatus.Pending }));
      }
      onReprocessFolder?.(confirmPath);
    }
    setConfirmPath(null);
  }, [confirmPath, onReprocessFolder, items]);

  const handleCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmPath(null);
  }, []);

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
      <div className="px-4 py-6 text-center text-3.25 text-text-muted">
        {query ? t('no_matches', 'No matches') : t('no_folders_found', 'No folders found')}
      </div>
    );
  }

  const showReload = onReprocessFile || onReprocessFolder;

  return (
    <>
      <ul className="list-none m-0 py-1 overflow-y-auto max-h-[340px]" role="listbox">
        {items.map((item, idx) => (
          <li
            key={item.relativePath}
            className={`group flex items-center gap-2 px-4 py-[7px] cursor-pointer transition-colors ${idx === selectedIndex ? 'bg-bg-hover' : 'hover:bg-bg-hover'}`}
            role="option"
            aria-selected={idx === selectedIndex}
            onClick={(e) => handleSelect(item, e)}
            onMouseEnter={() => setSelectedIndex(idx)}
          >
            <span className="inline-flex items-center shrink-0">{item.isDir ? <Icons.folder size={ICON_SIZE.MD} /> : <Icons.file size={ICON_SIZE.MD} />}</span>
            {itemStatuses[item.isDir ? item.name : item.relativePath] && (
              <StatusIcon status={itemStatuses[item.isDir ? item.name : item.relativePath]} />
            )}
            <span className="text-3.25 font-medium text-text shrink-0 whitespace-nowrap">{item.name}</span>
            <span className="text-2.75 text-text-muted whitespace-nowrap overflow-hidden text-ellipsis flex-1">{item.relativePath}</span>
            {showReload && (
              <button
                className="inline-flex items-center justify-center w-[22px] h-[22px] ml-auto p-0 border-none rounded bg-transparent text-text-secondary cursor-pointer shrink-0 opacity-0 transition-[opacity,background,color] group-hover:opacity-60 hover:!opacity-100 hover:bg-accent hover:text-white"
                title={item.isDir ? `${t('reprocess_all_files_in', 'Reprocess all files in')} ${item.relativePath}` : t('reprocess_this_file', 'Reprocess this file')}
                onClick={(e) => handleReprocess(e, item)}
              ><Icons.refresh size={ICON_SIZE.SM} /></button>
            )}
          </li>
        ))}
      </ul>
      {confirmPath && (
        <div className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border-t border-border text-3 text-text-secondary" onClick={(e) => e.stopPropagation()}>
          <span>{`${t('reprocess_all_files_in', 'Reprocess all files in')} `}<strong className="text-text">{confirmPath}</strong>?</span>
          <button className="px-2.5 py-[2px] border-none rounded-sm text-2.75 cursor-pointer bg-accent text-white hover:brightness-110" onClick={handleConfirm}>{t('yes', 'Yes')}</button>
          <button className="px-2.5 py-[2px] border-none rounded-sm text-2.75 cursor-pointer bg-transparent text-text-secondary hover:text-text" onClick={handleCancel}>{t('cancel', 'Cancel')}</button>
        </div>
      )}
    </>
  );
};
