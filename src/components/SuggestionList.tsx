import React from 'react';
import { SuggestionItem } from '../shared/suggestion-data';
import { Icon } from './Icon';
import { ICON_SIZE } from '../shared/icons';

interface Props {
  items: SuggestionItem[];
  selectedIndex: number;
  onAccept: (item: SuggestionItem) => void;
  onHover: (index: number) => void;
  visible: boolean;
}

export const SuggestionList: React.FC<Props> = ({ items, selectedIndex, onAccept, onHover, visible }) => {
  if (!visible || items.length === 0) return null;

  return (
    <div className="suggestion-chips" role="listbox">
      {items.map((item, i) => (
        <button
          key={item.insertText + item.label}
          className={`suggestion-chip${i === selectedIndex ? ' suggestion-chip--selected' : ''}`}
          role="option"
          aria-selected={i === selectedIndex}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => {
            e.preventDefault(); // prevent input blur
            onAccept(item);
          }}
        >
          <span className="suggestion-chip-icon">
            <Icon name={item.icon} size={ICON_SIZE.SM} />
            {item.directionIcon && <Icon name={item.directionIcon} size={ICON_SIZE.XS} />}
          </span>
          <span className="suggestion-chip-label">{item.label}</span>
          {item.hint && <span className="suggestion-chip-hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
};
