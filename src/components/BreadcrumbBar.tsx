import React from 'react';

interface Props {
  folder: string;
  onNavigate: (folder: string) => void;
  onOpenFolder: () => void;
  onClear: () => void;
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

export const BreadcrumbBar: React.FC<Props> = ({ folder, onNavigate, onOpenFolder, onClear }) => {
  const segments = splitSegments(folder);

  return (
    <div className="breadcrumb-bar">
      <span className="breadcrumb-root">📁</span>
      {segments.map((seg, i) => (
        <React.Fragment key={seg.path}>
          {i > 0 && <span className="breadcrumb-separator">&gt;</span>}
          <button
            className="breadcrumb-segment"
            onClick={() => onNavigate(seg.path)}
            title={`Scope to ${seg.path}`}
          >
            {seg.label}/
          </button>
        </React.Fragment>
      ))}
      <div className="breadcrumb-actions">
        <button
          className="breadcrumb-action-btn"
          onClick={onOpenFolder}
          title="Open in Finder"
          aria-label="Open folder in file manager"
        >
          📂
        </button>
        <button
          className="breadcrumb-action-btn"
          onClick={onClear}
          title="Clear folder scope"
          aria-label="Clear folder scope"
        >
          &times;
        </button>
      </div>
    </div>
  );
};

// Export for testing
export { splitSegments };
