import React from 'react';

interface Props {
  folder: string | null;
  file?: string | null;
  onNavigate: (folder: string) => void;
  onOpenFolder: () => void;
  onClear: () => void;
  onClearFile?: () => void;
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

export const BreadcrumbBar: React.FC<Props> = ({ folder, file, onNavigate, onOpenFolder, onClear, onClearFile }) => {
  const segments = folder ? splitSegments(folder) : [];
  const fileName = file ? extractFileName(file) : null;

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
      {fileName && (
        <>
          {segments.length > 0 && <span className="breadcrumb-separator">&gt;</span>}
          <span className="breadcrumb-file" title={file!}>
            📄 {fileName}
          </span>
          {onClearFile && (
            <button
              className="breadcrumb-file-clear"
              onClick={onClearFile}
              title="Clear file scope (show all records in folder)"
              aria-label="Clear file scope"
            >
              &times;
            </button>
          )}
        </>
      )}
      <div className="breadcrumb-actions">
        {folder && (
          <button
            className="breadcrumb-action-btn"
            onClick={onOpenFolder}
            title="Open in Finder"
            aria-label="Open folder in file manager"
          >
            📂
          </button>
        )}
        <button
          className="breadcrumb-action-btn"
          onClick={onClear}
          title="Clear all scope"
          aria-label="Clear all scope"
        >
          &times;
        </button>
      </div>
    </div>
  );
};

// Export for testing
export { splitSegments };
