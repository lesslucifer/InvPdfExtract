import React, { useState, useEffect, useCallback } from 'react';
import { FilterPreset, PresetFilters } from '../shared/types';

const DOC_TYPE_LABELS: Record<string, { icon: string; label: string }> = {
  bank_statement: { icon: '🏦', label: 'Bank Statement' },
  invoice_out: { icon: '📤', label: 'Invoice Out' },
  invoice_in: { icon: '📥', label: 'Invoice In' },
};

function formatAmount(n: number): string {
  if (n >= 1_000_000_000 && n % 1_000_000_000 === 0) return `${n / 1_000_000_000}t`;
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}tr`;
  if (n >= 1_000 && n % 1_000 === 0) return `${n / 1_000}k`;
  return new Intl.NumberFormat('vi-VN').format(n);
}

export function buildPresetSummary(filtersJson: string): string {
  try {
    const state: PresetFilters = JSON.parse(filtersJson);
    const parts: string[] = [];

    if (state.filters?.docType) {
      const dt = DOC_TYPE_LABELS[state.filters.docType];
      if (dt) parts.push(`${dt.icon} ${dt.label}`);
    }

    if (state.filters?.status) {
      parts.push(`⚡ ${state.filters.status}`);
    }

    if (state.filters?.amountMin != null && state.filters?.amountMax != null) {
      parts.push(`💰 ${formatAmount(state.filters.amountMin)}–${formatAmount(state.filters.amountMax)}`);
    } else if (state.filters?.amountMin != null) {
      parts.push(`💰 >${formatAmount(state.filters.amountMin)}`);
    } else if (state.filters?.amountMax != null) {
      parts.push(`💰 <${formatAmount(state.filters.amountMax)}`);
    }

    if (state.filters?.dateFilter) {
      parts.push(`📅 ${state.filters.dateFilter}`);
    }

    if (state.filters?.sortField) {
      const dir = state.filters.sortDirection || 'desc';
      parts.push(`↕️ ${state.filters.sortField}:${dir}`);
    }

    if (state.folderScope) {
      parts.push(`📁 ${state.folderScope}`);
    }

    if (state.fileScope) {
      parts.push(`📄 ${state.fileScope}`);
    }

    if (state.query?.trim()) {
      parts.push(`"${state.query.trim()}"`);
    }

    return parts.join(' · ') || 'No filters';
  } catch {
    return 'Invalid preset';
  }
}

interface Props {
  query: string;
  onLoadPreset: (filtersJson: string) => void;
  onDeletePreset: (id: string) => void;
  onWindowlizePreset: (filtersJson: string) => void;
}

export const PresetList: React.FC<Props> = ({ query, onLoadPreset, onDeletePreset, onWindowlizePreset }) => {
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    window.api.listPresets().then(setPresets).catch(() => setPresets([]));
  }, []);

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
    setPresets(prev => prev.filter(p => p.id !== id));
    onDeletePreset(id);
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

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (filtered.length === 0) {
    return (
      <div className="preset-list-empty">
        {query ? 'No matching presets' : 'No saved presets'}
      </div>
    );
  }

  return (
    <ul className="preset-list" role="listbox">
      {filtered.map((preset, idx) => (
        <li
          key={preset.id}
          className={`preset-item${idx === selectedIndex ? ' selected' : ''}`}
          role="option"
          aria-selected={idx === selectedIndex}
          onClick={(e) => handleSelect(preset, e)}
          onMouseEnter={() => setSelectedIndex(idx)}
        >
          <div className="preset-item__line1">
            <span className="preset-item__star">★</span>
            <span className="preset-item__name">{preset.name}</span>
            <button
              className="preset-item__delete"
              onClick={(e) => handleDelete(e, preset.id)}
              aria-label={`Delete ${preset.name}`}
              title="Delete preset"
            >×</button>
          </div>
          <div className="preset-item__line2">
            {buildPresetSummary(preset.filtersJson)}
          </div>
        </li>
      ))}
    </ul>
  );
};
