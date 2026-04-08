import { t } from '../lib/i18n';
import React, { useState, useRef, useEffect } from 'react';
import { useDuplicateSources } from '../lib/queries';
import { Icons, ICON_SIZE } from '../shared/icons';

interface Props {
  recordId: string;
}

export const DupBadge: React.FC<Props> = ({ recordId }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: sources } = useDuplicateSources({ id: recordId });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!sources || sources.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <span
        className="inline-flex items-center gap-[3px] text-2.75 font-medium pl-1 pr-1.5 py-[1px] rounded-full bg-confidence-medium/10 text-confidence-medium cursor-pointer hover:bg-confidence-medium/20 transition-colors"
        title={t('duplicate_detected', 'Duplicate detected across files')}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        <Icons.copy size={ICON_SIZE.XS} />
        {sources.length}
      </span>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border rounded-md shadow-lg py-1.5 px-2 min-w-[200px] max-w-[320px]">
          <div className="text-2.75 text-confidence-medium font-semibold mb-1">
            {t('duplicate_sources_title', 'Also found in')}
          </div>
          {sources.map(src => {
            const parts = src.relative_path.split('/');
            const filename = parts[parts.length - 1];
            const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
            return (
              <div
                key={src.id}
                className="flex items-center gap-1.5 text-2.75 text-text-secondary py-1 px-1 -mx-1 rounded cursor-pointer hover:bg-bg-hover transition-colors"
                title={src.relative_path}
                onClick={(e) => { e.stopPropagation(); window.api.locateFile(src.relative_path); }}
              >
                <Icons.file size={ICON_SIZE.SM} className="shrink-0 text-text-muted" />
                <span className="truncate">{filename}</span>
                {folder && <span className="text-text-muted ml-auto shrink-0 text-[10px]">{folder}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
