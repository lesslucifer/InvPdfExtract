import { t } from '../lib/i18n';
import React, { useState, useRef, useEffect } from 'react';
import { FieldOverrideInfo, OverrideStatus } from '../shared/types';
import { formatCurrency } from '../shared/format';
import { Icons, ICON_SIZE } from '../shared/icons';

interface Props {
  label: string;
  value: string;
  fieldName: string;
  tableName: string;
  recordId: string;
  override?: FieldOverrideInfo;
  inputType?: 'text' | 'number' | 'date';
  derivedValue?: number | null;
  showMismatchIcon?: boolean;
  onSave: (value: string) => void;
  onResolve?: (action: 'keep' | 'accept') => void;
}

export const EditableField: React.FC<Props> = ({
  label, value, fieldName: _fieldName, tableName: _tableName, recordId: _recordId, override, inputType = 'text', derivedValue, showMismatchIcon = false, onSave, onResolve,
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
      onSave(editValue);
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

  const StatusIcon = isConflict ? Icons.conflict : isLocked ? Icons.overridden : null;

  const displayValue = value
    ? (inputType === 'number' ? formatCurrency(Number(value)) : value)
    : '-';

  return (
    <tr className={`editable-field ${isConflict ? 'field-conflict' : ''}`}>
      <td className="py-[3px] pr-2 text-3 text-text-secondary font-medium whitespace-nowrap w-[100px] align-top">
        {StatusIcon && <span className="inline-flex items-center mr-1" title={isConflict ? 'Conflict' : 'Overridden'}><StatusIcon size={ICON_SIZE.SM} /></span>}
        {label}
      </td>
      <td className="relative py-[3px] text-3 align-top">
        {editing ? (
          <span className="flex gap-1 items-center">
            <input
              ref={inputRef}
              className="flex-1 border border-accent rounded bg-bg text-text text-3 px-1.5 py-[2px] font-sans outline-none"
              type={inputType}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
            />
          </span>
        ) : (
          <span className={`field-display cursor-pointer px-1 py-[1px] rounded-sm transition-colors ${showMismatchIcon ? 'field-mismatch cursor-pointer' : ''}`} onClick={(e) => {
            if ((e.metaKey || e.ctrlKey) && derivedValue != null) {
              e.preventDefault();
              onSave(String(derivedValue));
              return;
            }
            setEditValue(value); setEditing(true);
          }} title={derivedValue != null ? `⌘+click → ${formatCurrency(derivedValue)}` : undefined}>
            {displayValue}
            {showMismatchIcon && derivedValue != null && <span className="text-confidence-low text-2.75 font-semibold"> ({formatCurrency(derivedValue)}!)</span>}
          </span>
        )}

        {isConflict && !editing && onResolve && (
          <div className="mt-1">
            <div className="text-2.75 mb-1">
              <span className="text-confidence-medium italic">{`${t('ai_suggests', 'AI suggests')}: `}{override!.ai_value_latest}</span>
            </div>
            <div className="flex gap-1.5">
              <button className="border-none rounded px-2 py-[2px] text-2.75 font-medium cursor-pointer bg-bg-hover text-text hover:bg-border" onClick={() => onResolve('keep')}>{t('keep_mine', 'Keep mine')}</button>
              <button className="border-none rounded px-2 py-[2px] text-2.75 font-medium cursor-pointer bg-accent text-white hover:opacity-85" onClick={() => onResolve('accept')}>{t('accept_ai', 'Accept AI')}</button>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
};
