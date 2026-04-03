import React, { useState, useEffect } from 'react';
import { FolderInfo, AggregateStats, SearchFilters } from '../shared/types';
import { StickyFooter } from './StickyFooter';

const ALL_FILTERS: SearchFilters = {};

interface HomeScreenProps {
  onFolderBrowse: (folder: string) => void;
  onOpenFolder: (relativePath: string) => void;
  onSettingsClick: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onFolderBrowse,
  onOpenFolder,
  onSettingsClick,
}) => {
  const [recentFolders, setRecentFolders] = useState<FolderInfo[]>([]);
  const [topFolders, setTopFolders] = useState<FolderInfo[]>([]);
  const [aggregates, setAggregates] = useState<AggregateStats>({ totalRecords: 0, totalAmount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [recent, top, agg] = await Promise.all([
          window.api.listRecentFolders(5),
          window.api.listTopFolders(),
          window.api.getAggregates(ALL_FILTERS),
        ]);
        if (cancelled) return;
        setRecentFolders(recent);
        setTopFolders(top);
        setAggregates(agg);
      } catch (err) {
        console.error('[HomeScreen] Failed to load folders:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
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
              onBrowse={onFolderBrowse}
              onOpen={onOpenFolder}
            />
          ))}
          {supplementFolders.map(folder => (
            <FolderRow
              key={folder.path}
              folder={folder}
              onBrowse={onFolderBrowse}
              onOpen={onOpenFolder}
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
              &#x1F4C2;
            </button>
          </div>
          {topFolders.map(folder => (
            <FolderRow
              key={folder.path}
              folder={folder}
              onBrowse={onFolderBrowse}
              onOpen={onOpenFolder}
            />
          ))}
        </div>
      )}
      </div>
      <StickyFooter stats={aggregates} filters={ALL_FILTERS} />
    </div>
  );
};

interface FolderRowProps {
  folder: FolderInfo;
  onBrowse: (folder: string) => void;
  onOpen: (relativePath: string) => void;
}

const FolderRow: React.FC<FolderRowProps> = ({ folder, onBrowse, onOpen }) => {
  return (
    <div className="folder-row" onClick={() => onBrowse(folder.path)} role="button" tabIndex={0}>
      <span className="folder-icon">&#x1F4C1;</span>
      <span className="folder-path">{folder.path}/</span>
      <span className="folder-count">{folder.recordCount} rec</span>
      <div className="folder-row-actions">
        <button
          className="folder-open-btn"
          onClick={(e) => { e.stopPropagation(); onOpen(folder.path); }}
          aria-label={`Open ${folder.path} in file manager`}
          title="Open in Finder"
        >
          &#x1F4C2;
        </button>
      </div>
    </div>
  );
};
