import React, { useState, useCallback } from 'react';
import { FileStatus } from '../shared/types';
import { StickyFooter } from './StickyFooter';
import { StatusDot } from './StatusDot';
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
  onSettingsClick,
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
      <div className="home-screen">
        <div className="home-loading">Loading...</div>
      </div>
    );
  }

  const hasRecent = recentFolders.length > 0;
  const hasTop = topFolders.length > 0;

  // If fewer than 3 recent folders, supplement with top folders not already shown
  const recentPaths = new Set(recentFolders.map(f => f.path));
  const supplementFolders = recentFolders.length < 3
    ? topFolders.filter(f => !recentPaths.has(f.path))
    : [];

  if (!hasRecent && !hasTop) {
    return (
      <div className="home-screen">
        <div className="home-content">
          <div className="home-placeholder">
            <p className="home-hint">No records yet. Add files to your vault to get started.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="home-screen">
      <div className="home-content">
      {(hasRecent || supplementFolders.length > 0) && (
        <div className="home-section">
          <div className="home-section-title">Recent folders</div>
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
        <div className="home-section">
          <div className="home-section-header">
            <span className="home-section-title">All folders</span>
            <button
              className="folder-open-btn"
              onClick={() => onOpenFolder('')}
              aria-label="Open vault root in file manager"
              title="Open vault root"
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
      <div className="folder-row" onClick={() => onBrowse(folder.path)} role="button" tabIndex={0}>
        <span className="folder-icon"><Icons.folder size={ICON_SIZE.MD} /></span>
        {folderStatus && <StatusDot status={folderStatus} />}
        <span className="folder-path">{folder.path}/</span>
        <span className="folder-count">{folder.recordCount} rec</span>
        <div className="folder-row-actions">
          {onReprocess && (
            <button
              className="folder-reload-btn"
              onClick={handleReprocess}
              aria-label={`Reprocess all files in ${folder.path}`}
              title="Reprocess folder"
            >
              <Icons.refresh size={ICON_SIZE.SM} />
            </button>
          )}
          <button
            className="folder-open-btn"
            onClick={(e) => { e.stopPropagation(); onOpen(folder.path); }}
            aria-label={`Open ${folder.path} in file manager`}
            title="Open in Finder"
          >
            <Icons.folderOpen size={ICON_SIZE.MD} />
          </button>
        </div>
      </div>
      {confirmPending && (
        <div className="result-confirm-bar" onClick={(e) => e.stopPropagation()}>
          <span>Reprocess all files in <strong>{folder.path}</strong>?</span>
          <button className="result-confirm-yes" onClick={handleConfirm}>Yes</button>
          <button className="result-confirm-no" onClick={handleCancel}>Cancel</button>
        </div>
      )}
    </>
  );
};
