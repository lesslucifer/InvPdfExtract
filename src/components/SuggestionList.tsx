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
    <div className="flex flex-wrap gap-1.5 px-4 py-1.5 border-b border-border animate-suggestion-in shrink-0" role="listbox">
      {items.map((item, i) => (
        <button
          key={item.insertText + item.label}
          className={`inline-flex items-center gap-1 px-2.5 py-[3px] text-3 border border-border rounded-full cursor-pointer transition-[background,color,border-color] ${i === selectedIndex ? 'bg-bg-hover text-text border-accent' : 'text-text-secondary bg-bg-secondary hover:bg-bg-hover hover:text-text'}`}
          role="option"
          aria-selected={i === selectedIndex}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onAccept(item);
          }}
        >
          <span className="inline-flex items-center gap-[1px]">
            <Icon name={item.icon} size={ICON_SIZE.SM} />
            {item.directionIcon && <Icon name={item.directionIcon} size={ICON_SIZE.XS} />}
          </span>
          <span className="whitespace-nowrap">{item.label}</span>
          {item.hint && <span className="text-text-muted text-2.75 ml-0.5">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
};
