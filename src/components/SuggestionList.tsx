import React from 'react';
import { SuggestionItem } from '../shared/suggestion-data';

interface Props {
  items: SuggestionItem[];
  selectedIndex: number;
  onAccept: (item: SuggestionItem) => void;
  onHover: (index: number) => void;
  visible: boolean;
  onDeletePreset?: (presetId: string) => void;
  onCtrlClickPreset?: (presetId: string) => void;
}

export const SuggestionList: React.FC<Props> = ({ items, selectedIndex, onAccept, onHover, visible, onDeletePreset, onCtrlClickPreset }) => {
  if (!visible || items.length === 0) return null;

  return (
    <div className="suggestion-chips" role="listbox">
      {items.map((item, i) => {
        const isPreset = item.category === 'preset';

        return (
          <button
            key={item.presetId || (item.insertText + item.label)}
            className={`suggestion-chip${i === selectedIndex ? ' suggestion-chip--selected' : ''}${isPreset ? ' suggestion-chip--preset' : ''}`}
            role="option"
            aria-selected={i === selectedIndex}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              e.preventDefault(); // prevent input blur
              if (isPreset && item.presetId) {
                if (e.metaKey || e.ctrlKey) {
                  onCtrlClickPreset?.(item.presetId);
                  return;
                }
              }
              onAccept(item);
            }}
          >
            <span className="suggestion-chip-icon">{item.icon}</span>
            <span className="suggestion-chip-label">{item.label}</span>
            {item.hint && <span className="suggestion-chip-hint">{item.hint}</span>}
            {isPreset && item.presetId && onDeletePreset && (
              <span
                className="suggestion-chip-close"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDeletePreset(item.presetId!);
                }}
              >
                &times;
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
