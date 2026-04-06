import { t } from '../lib/i18n';
import React, { useState, useRef, useEffect } from 'react';
import { FieldOverrideInfo, OverrideStatus } from '../shared/types';
import { Icons, ICON_SIZE } from '../shared/icons';
import { formatCurrency } from '../shared/format';

interface Props {
  value: string;
  fieldName: string;
  lineItemId: string;
  override?: FieldOverrideInfo;
  inputType?: 'text' | 'number';
  derivedValue?: number | null;
  showMismatchIcon?: boolean;
  onSave: (lineItemId: string, fieldName: string, value: string) => void;
  onResolve?: (lineItemId: string, fieldName: string, action: 'keep' | 'accept') => void;
}

export const EditableCell: React.FC<Props> = ({
  value, fieldName, lineItemId, override, inputType = 'text', derivedValue, showMismatchIcon = false, onSave, onResolve,
}) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const isLocked = override?.status === OverrideStatus.Locked;
  const isConflict = override?.status === OverrideStatus.Conflict;

  const handleSave = () => {
    if (editValue !== value) {
      onSave(lineItemId, fieldName, editValue);
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setEditValue(value);
      setEditing(false);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if ((e.metaKey || e.ctrlKey) && derivedValue != null) {
      e.preventDefault();
      onSave(lineItemId, fieldName, String(derivedValue));
      return;
    }
    setEditValue(value);
    setEditing(true);
  };

  const StatusIcon = isConflict ? Icons.conflict : isLocked ? Icons.overridden : null;
  const hasDerived = derivedValue != null;

  const displayValue = value
    ? (inputType === 'number' ? formatCurrency(Number(value)) : value)
    : '-';

  return (
    <td className={`editable-cell relative ${isConflict ? 'cell-conflict' : ''} ${showMismatchIcon ? 'cell-mismatch' : ''}`}>
      {editing ? (
        <input
          ref={inputRef}
          className="w-full border border-accent rounded-sm bg-bg text-text text-2.75 px-1 py-[1px] font-sans outline-none box-border"
          type={inputType}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
        />
      ) : (
        <span className="cell-display inline-block min-w-[20px] px-[3px] py-[1px] rounded-sm transition-colors" onClick={handleClick} title={hasDerived ? `⌘+click → ${formatCurrency(derivedValue)}` : undefined}>
          {StatusIcon && <span className="inline-flex items-center mr-0.5" title={isConflict ? 'Conflict' : 'Overridden'}><StatusIcon size={ICON_SIZE.XS} /></span>}
          {showMismatchIcon && <span className="text-confidence-low text-2.5 font-bold mr-0.5">!</span>}
          {displayValue}
        </span>
      )}
      {isConflict && !editing && onResolve && (
        <div className="absolute top-full left-0 z-10 bg-bg-secondary border border-border rounded px-1.5 py-1 text-2.5 whitespace-nowrap shadow-dropdown">
          <div className="text-confidence-medium italic mb-[3px]">{`${t('ai', 'AI')}: `}{override!.ai_value_latest}</div>
          <div className="flex gap-1">
            <button className="border-none rounded px-1.5 py-[1px] text-2.5 font-medium cursor-pointer bg-bg-hover text-text hover:bg-border" onClick={() => onResolve(lineItemId, fieldName, 'keep')}>{t('keep', 'Keep')}</button>
            <button className="border-none rounded px-1.5 py-[1px] text-2.5 font-medium cursor-pointer bg-accent text-white hover:opacity-85" onClick={() => onResolve(lineItemId, fieldName, 'accept')}>{t('accept', 'Accept')}</button>
          </div>
        </div>
      )}
    </td>
  );
};
