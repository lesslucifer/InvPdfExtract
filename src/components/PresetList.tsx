import { t } from '../lib/i18n';
import React, { useState, useEffect, useCallback } from 'react';
import { FilterPreset, PresetFilters } from '../shared/types';
import { formatCurrency } from '../shared/format';
import { DOC_TYPE_ICONS, Icons, ICON_SIZE } from '../shared/icons';
import { usePresets } from '../lib/queries';

function formatAmount(n: number): string {
  return formatCurrency(n, { abbreviated: true });
}

export function buildPresetSummary(filtersJson: string): string {
  try {
    const state: PresetFilters = JSON.parse(filtersJson);
    const parts: string[] = [];

    if (state.filters?.docType) {
      const dt = DOC_TYPE_ICONS[state.filters.docType];
      if (dt) parts.push(dt.label);
    }

    if (state.filters?.status) {
      parts.push(state.filters.status);
    }

    if (state.filters?.amountMin != null && state.filters?.amountMax != null) {
      parts.push(`${formatAmount(state.filters.amountMin)}–${formatAmount(state.filters.amountMax)}`);
    } else if (state.filters?.amountMin != null) {
      parts.push(`>${formatAmount(state.filters.amountMin)}`);
    } else if (state.filters?.amountMax != null) {
      parts.push(`<${formatAmount(state.filters.amountMax)}`);
    }

    if (state.filters?.dateFilter) {
      parts.push(state.filters.dateFilter);
    }

    if (state.filters?.sortField) {
      const dir = state.filters.sortDirection || 'desc';
      parts.push(`${state.filters.sortField}:${dir}`);
    }

    if (state.folderScope) {
      parts.push(state.folderScope);
    }

    if (state.fileScope) {
      parts.push(state.fileScope);
    }

    if (state.query?.trim()) {
      parts.push(`"${state.query.trim()}"`);
    }

    return parts.join(' · ') || t('no_filters', 'No filters');
  } catch {
    return t('invalid_preset', 'Invalid preset');
  }
}

interface Props {
  query: string;
  onLoadPreset: (filtersJson: string) => void;
  onDeletePreset: (id: string) => void;
  onWindowlizePreset: (filtersJson: string) => void;
}

export const PresetList: React.FC<Props> = ({ query, onLoadPreset, onDeletePreset, onWindowlizePreset }) => {
  const { data: presets = [] } = usePresets();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = query
    ? presets.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
    : presets;

  const handleSelect = useCallback((preset: FilterPreset, e?: React.MouseEvent | KeyboardEvent) => {
    const metaOrCtrl = e && ('metaKey' in e) && (e.metaKey || e.ctrlKey);
    if (metaOrCtrl) {
      onWindowlizePreset(preset.filtersJson);
    } else {
      onLoadPreset(preset.filtersJson);
    }
  }, [onLoadPreset, onWindowlizePreset]);

  const handleDelete = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onDeletePreset(id);
    usePresets.invalidate();
  }, [onDeletePreset]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          handleSelect(filtered[selectedIndex], e);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filtered, selectedIndex, handleSelect]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (filtered.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-3.25 text-text-muted">
        {query ? t('no_matching_presets', 'No matching presets') : t('no_saved_presets', 'No saved presets')}
      </div>
    );
  }

  return (
    <ul className="list-none m-0 py-1 overflow-y-auto max-h-[340px]" role="listbox">
      {filtered.map((preset, idx) => (
        <li
          key={preset.id}
          className={`group flex flex-col px-4 py-2 cursor-pointer transition-colors ${idx === selectedIndex ? 'bg-bg-hover' : 'hover:bg-bg-hover'}`}
          role="option"
          aria-selected={idx === selectedIndex}
          onClick={(e) => handleSelect(preset, e)}
          onMouseEnter={() => setSelectedIndex(idx)}
        >
          <div className="flex items-center gap-2">
            <span className="text-accent inline-flex items-center shrink-0"><Icons.star size={ICON_SIZE.SM} /></span>
            <span className="text-3.25 font-medium text-text flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{preset.name}</span>
            <button
              className="inline-flex items-center justify-center w-[22px] h-[22px] p-0 border-none rounded bg-transparent text-text-secondary cursor-pointer shrink-0 opacity-0 transition-[opacity,background,color] group-hover:opacity-60 hover:!opacity-100 hover:bg-confidence-low hover:text-white"
              onClick={(e) => handleDelete(e, preset.id)}
              aria-label={`Delete ${preset.name}`}
              title="Delete preset"
            ><Icons.close size={ICON_SIZE.XS} /></button>
          </div>
          <div className="text-2.75 text-text-muted pl-[22px] mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
            {buildPresetSummary(preset.filtersJson)}
          </div>
        </li>
      ))}
    </ul>
  );
};
