import React from 'react';
import { Icons, ICON_SIZE } from '../shared/icons';
import { useSearchStore } from '../stores';

interface Props {
  onNavigate: (folder: string) => void;
  onOpenFolder: () => void;
  onReload?: () => void;
}

interface Segment {
  label: string;
  path: string;
}

function splitSegments(folder: string): Segment[] {
  const parts = folder.split('/').filter(Boolean);
  return parts.map((label, i) => ({
    label,
    path: parts.slice(0, i + 1).join('/'),
  }));
}

function extractFileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

export const BreadcrumbBar: React.FC<Props> = ({ onNavigate, onOpenFolder, onReload }) => {
  const folder = useSearchStore(s => s.folderScope);
  const file = useSearchStore(s => s.fileScope);
  const clearFolderScope = useSearchStore(s => s.clearFolderScope);
  const clearFileScope = useSearchStore(s => s.clearFileScope);

  const segments = folder ? splitSegments(folder) : [];
  const fileName = file ? extractFileName(file) : null;

  return (
    <div className="breadcrumb-bar">
      <span className="breadcrumb-root"><Icons.folder size={ICON_SIZE.MD} /></span>
      {segments.map((seg, i) => (
        <React.Fragment key={seg.path}>
          {i > 0 && <span className="breadcrumb-separator"><Icons.chevronRight size={ICON_SIZE.XS} /></span>}
          <button
            className="breadcrumb-segment"
            onClick={() => onNavigate(seg.path)}
            title={`Scope to ${seg.path}`}
          >
            {seg.label}/
          </button>
        </React.Fragment>
      ))}
      {fileName && (
        <>
          {segments.length > 0 && <span className="breadcrumb-separator"><Icons.chevronRight size={ICON_SIZE.XS} /></span>}
          <span className="breadcrumb-file" title={file!}>
            <Icons.file size={ICON_SIZE.SM} /> {fileName}
          </span>
          <button
            className="breadcrumb-file-clear"
            onClick={clearFileScope}
            title="Clear file scope (show all records in folder)"
            aria-label="Clear file scope"
          >
            <Icons.close size={ICON_SIZE.XS} />
          </button>
        </>
      )}
      <div className="breadcrumb-actions">
        {onReload && (
          <button
            className="breadcrumb-action-btn"
            onClick={onReload}
            title={file ? 'Reprocess this file' : 'Reprocess folder'}
            aria-label={file ? 'Reprocess file' : 'Reprocess folder'}
          >
            <Icons.refresh size={ICON_SIZE.MD} />
          </button>
        )}
        {folder && (
          <button
            className="breadcrumb-action-btn"
            onClick={onOpenFolder}
            title="Open in Finder"
            aria-label="Open folder in file manager"
          >
            <Icons.folderOpen size={ICON_SIZE.MD} />
          </button>
        )}
        <button
          className="breadcrumb-action-btn"
          onClick={clearFolderScope}
          title="Clear all scope"
          aria-label="Clear all scope"
        >
          <Icons.close size={ICON_SIZE.MD} />
        </button>
      </div>
    </div>
  );
};

// Export for testing
export { splitSegments };
