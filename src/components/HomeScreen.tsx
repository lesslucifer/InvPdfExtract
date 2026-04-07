import { t } from '../lib/i18n';
import React, { useState, useCallback } from 'react';
import { FileStatus } from '../shared/types';
import { StickyFooter } from './StickyFooter';
import { StatusIcon } from './StatusIcon';
import { Icons, ICON_SIZE } from '../shared/icons';
import { useHomeData, useFolderStatuses } from '../lib/queries';

interface HomeScreenProps {
  onFolderBrowse: (folder: string) => void;
  onOpenFolder: (relativePath: string) => void;
  onSettingsClick: () => void;
  onReprocessFolder?: (folderPrefix: string) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onFolderBrowse,
  onOpenFolder,
  onSettingsClick: _onSettingsClick,
  onReprocessFolder,
}) => {
  const { data: homeData, isLoading: homeLoading } = useHomeData();
  const { data: folderStatuses = {} } = useFolderStatuses();

  const recentFolders = homeData?.recentFolders ?? [];
  const topFolders = homeData?.topFolders ?? [];

  const handleOptimisticFolderUpdate = useCallback((folderPath: string) => {
    useFolderStatuses.setData(undefined, undefined, (old) => ({
      ...old,
      [folderPath]: FileStatus.Pending,
    }));
  }, []);

  if (homeLoading) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="px-8 py-8 text-center text-text-muted">{`${t('loading', 'Loading')}...`}</div>
      </div>
    );
  }

  const hasRecent = recentFolders.length > 0;
  const hasTop = topFolders.length > 0;

  const recentPaths = new Set(recentFolders.map(f => f.path));
  const supplementFolders = recentFolders.length < 3
    ? topFolders.filter(f => !recentPaths.has(f.path))
    : [];

  if (!hasRecent && !hasTop) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto py-2">
          <div className="px-6 py-8 text-center">
            <p className="text-text-muted text-3.25">{`${t('no_records_yet_add_files_to_your_vault_to_get_started', 'No records yet. Add files to your vault to get started')}.`}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto py-2">
        {(hasRecent || supplementFolders.length > 0) && (
          <div className="py-1">
            <div className="text-2.75 font-semibold text-text-secondary uppercase tracking-[0.5px] px-4 py-1.5">{t('recent_folders', 'Recent folders')}</div>
            {recentFolders.map(folder => (
              <FolderRow
                key={folder.path}
                folder={folder}
                folderStatus={folderStatuses[folder.path]}
                onBrowse={onFolderBrowse}
                onOpen={onOpenFolder}
                onReprocess={onReprocessFolder}
                onOptimisticUpdate={handleOptimisticFolderUpdate}
              />
            ))}
            {supplementFolders.map(folder => (
              <FolderRow
                key={folder.path}
                folder={folder}
                folderStatus={folderStatuses[folder.path]}
                onBrowse={onFolderBrowse}
                onOpen={onOpenFolder}
                onReprocess={onReprocessFolder}
                onOptimisticUpdate={handleOptimisticFolderUpdate}
              />
            ))}
          </div>
        )}

        {hasTop && (
          <div className="py-1">
            <div className="flex items-center justify-between px-4">
              <span className="text-2.75 font-semibold text-text-secondary uppercase tracking-[0.5px] py-1.5">{t('all_folders', 'All folders')}</span>
              <button
                className="bg-transparent border-none text-text-secondary cursor-pointer px-1 py-[2px] rounded inline-flex items-center hover:text-text hover:bg-bg-secondary"
                onClick={() => onOpenFolder('')}
                aria-label="Locate vault root in file manager"
                title="Locate vault root"
              >
                <Icons.folderOpen size={ICON_SIZE.MD} />
              </button>
            </div>
            {topFolders.map(folder => (
              <FolderRow
                key={folder.path}
                folder={folder}
                folderStatus={folderStatuses[folder.path]}
                onBrowse={onFolderBrowse}
                onOpen={onOpenFolder}
                onReprocess={onReprocessFolder}
                onOptimisticUpdate={handleOptimisticFolderUpdate}
              />
            ))}
          </div>
        )}
      </div>
      <StickyFooter />
    </div>
  );
};

interface FolderRowProps {
  folder: { path: string; recordCount: number };
  folderStatus?: FileStatus;
  onBrowse: (folder: string) => void;
  onOpen: (relativePath: string) => void;
  onReprocess?: (folderPrefix: string) => void;
  onOptimisticUpdate?: (folderPath: string) => void;
}

const FolderRow: React.FC<FolderRowProps> = ({ folder, folderStatus, onBrowse, onOpen, onReprocess, onOptimisticUpdate }) => {
  const [confirmPending, setConfirmPending] = useState(false);

  const handleReprocess = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onReprocess) return;
    try {
      const { count } = await window.api.countFolderFiles(folder.path);
      if (count > 10) {
        setConfirmPending(true);
      } else {
        onOptimisticUpdate?.(folder.path);
        onReprocess(folder.path);
      }
    } catch {
      onOptimisticUpdate?.(folder.path);
      onReprocess(folder.path);
    }
  }, [onReprocess, onOptimisticUpdate, folder.path]);

  const handleConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onOptimisticUpdate?.(folder.path);
    onReprocess?.(folder.path);
    setConfirmPending(false);
  }, [onReprocess, onOptimisticUpdate, folder.path]);

  const handleCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmPending(false);
  }, []);

  return (
    <>
      <div className="group flex items-center gap-2 px-4 py-1.5 cursor-pointer transition-colors hover:bg-bg-hover" onClick={() => onBrowse(folder.path)} role="button" tabIndex={0}>
        <span className="inline-flex items-center shrink-0 w-5 text-center"><Icons.folder size={ICON_SIZE.MD} /></span>
        {folderStatus && <StatusIcon status={folderStatus} />}
        <span className="flex-1 text-3.25 text-text overflow-hidden text-ellipsis whitespace-nowrap min-w-0">{folder.path}/</span>
        <span className="text-2.75 text-text-muted whitespace-nowrap shrink-0">{folder.recordCount}{` ${t('rec', 'rec')}`}</span>
        <div className="flex gap-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
          {onReprocess && (
            <button
              className="bg-transparent border-none text-text-secondary cursor-pointer px-1 py-[2px] rounded inline-flex items-center hover:text-accent hover:bg-bg-secondary"
              onClick={handleReprocess}
              aria-label={`Reprocess all files in ${folder.path}`}
              title="Reprocess folder"
            >
              <Icons.refresh size={ICON_SIZE.SM} />
            </button>
          )}
          <button
            className="bg-transparent border-none text-text-secondary cursor-pointer px-1 py-[2px] rounded inline-flex items-center hover:text-text hover:bg-bg-secondary"
            onClick={(e) => { e.stopPropagation(); onOpen(folder.path); }}
            aria-label={`Locate ${folder.path} in file manager`}
            title="Locate in Finder"
          >
            <Icons.folderOpen size={ICON_SIZE.MD} />
          </button>
        </div>
      </div>
      {confirmPending && (
        <div className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border-t border-border text-3 text-text-secondary" onClick={(e) => e.stopPropagation()}>
          <span>{`${t('reprocess_all_files_in', 'Reprocess all files in')} `}<strong className="text-text">{folder.path}</strong>?</span>
          <button className="px-2.5 py-[2px] border-none rounded-sm text-2.75 cursor-pointer bg-accent text-white hover:brightness-110" onClick={handleConfirm}>{t('yes', 'Yes')}</button>
          <button className="px-2.5 py-[2px] border-none rounded-sm text-2.75 cursor-pointer bg-transparent text-text-secondary hover:text-text" onClick={handleCancel}>{t('cancel', 'Cancel')}</button>
        </div>
      )}
    </>
  );
};
