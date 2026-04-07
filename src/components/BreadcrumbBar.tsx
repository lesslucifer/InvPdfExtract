import React from 'react';
import { Icons, ICON_SIZE } from '../shared/icons';
import { useSearchStore } from '../stores';
import { t } from '../lib/i18n';

interface Props {
  onNavigate: (folder: string) => void;
  onOpenFolder: () => void;
  onReload?: () => void;
  onReloadJE?: (aiOnly: boolean) => void;
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

const actionBtnClass = 'bg-transparent border-none text-text-muted cursor-pointer px-1 py-[1px] rounded inline-flex items-center hover:text-text hover:bg-bg-hover';

export const BreadcrumbBar: React.FC<Props> = ({ onNavigate, onOpenFolder, onReload, onReloadJE }) => {
  const folder = useSearchStore(s => s.folderScope);
  const file = useSearchStore(s => s.fileScope);
  const clearFolderScope = useSearchStore(s => s.clearFolderScope);
  const clearFileScope = useSearchStore(s => s.clearFileScope);

  const segments = folder ? splitSegments(folder) : [];
  const fileName = file ? extractFileName(file) : null;

  return (
    <div className="flex items-center gap-1 px-4 py-1 bg-bg-secondary border-b border-border text-3">
      <span className="inline-flex items-center shrink-0"><Icons.folder size={ICON_SIZE.MD} /></span>
      {segments.map((seg, i) => (
        <React.Fragment key={seg.path}>
          {i > 0 && <span className="text-text-muted inline-flex items-center shrink-0"><Icons.chevronRight size={ICON_SIZE.XS} /></span>}
          <button
            className="bg-transparent border-none text-text-secondary cursor-pointer px-1 py-[1px] rounded text-3 font-sans whitespace-nowrap hover:text-accent hover:bg-bg-hover"
            onClick={() => onNavigate(seg.path)}
            title={`${t('scope_to', 'Scope to')} ${seg.path}`}
          >
            {seg.label}/
          </button>
        </React.Fragment>
      ))}
      {fileName && (
        <>
          {segments.length > 0 && <span className="text-text-muted inline-flex items-center shrink-0"><Icons.chevronRight size={ICON_SIZE.XS} /></span>}
          <span className="text-accent text-3 whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px] inline-flex items-center gap-1" title={file!}>
            <Icons.file size={ICON_SIZE.SM} /> {fileName}
          </span>
          <button
            className="bg-transparent border-none text-text-muted cursor-pointer text-3 px-0.5 rounded leading-none shrink-0 hover:text-text hover:bg-bg-hover"
            onClick={clearFileScope}
            title={t('clear_file_scope_hint', 'Clear file scope (show all records in folder)')}
            aria-label={t('clear_file_scope', 'Clear file scope')}
          >
            <Icons.close size={ICON_SIZE.XS} />
          </button>
        </>
      )}
      <div className="ml-auto flex gap-1 shrink-0">
        {onReloadJE && (
          <button
            className={actionBtnClass}
            onClick={(e) => onReloadJE(e.ctrlKey || e.metaKey)}
            title={t('reload_je_hint', 'Reload JE for all records in scope · Ctrl/⌘+click for AI only')}
            aria-label={t('reload_all_je', 'Reload all JE')}
          >
            <Icons.refreshJE size={ICON_SIZE.MD} />
          </button>
        )}
        {onReload && (
          <button
            className={actionBtnClass}
            onClick={onReload}
            title={file ? t('reprocess_this_file', 'Reprocess this file') : t('reprocess_folder', 'Reprocess folder')}
            aria-label={file ? t('reprocess_this_file', 'Reprocess this file') : t('reprocess_folder', 'Reprocess folder')}
          >
            <Icons.refresh size={ICON_SIZE.MD} />
          </button>
        )}
        {folder && (
          <button
            className={actionBtnClass}
            onClick={onOpenFolder}
            title={t('locate_in_finder', 'Locate in Finder')}
            aria-label={t('locate_folder_in_file_manager', 'Locate folder in file manager')}
          >
            <Icons.folderOpen size={ICON_SIZE.MD} />
          </button>
        )}
        <button
          className={actionBtnClass}
          onClick={clearFolderScope}
          title={t('clear_all_scope', 'Clear all scope')}
          aria-label={t('clear_all_scope', 'Clear all scope')}
        >
          <Icons.close size={ICON_SIZE.MD} />
        </button>
      </div>
    </div>
  );
};

// Export for testing
export { splitSegments };
