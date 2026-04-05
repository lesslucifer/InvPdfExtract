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
  label, value, fieldName, tableName, recordId, override, inputType = 'text', derivedValue, showMismatchIcon = false, onSave, onResolve,
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
      <td className="detail-label">
        {StatusIcon && <span className="field-status-icon" title={isConflict ? 'Conflict' : 'Overridden'}><StatusIcon size={ICON_SIZE.SM} /></span>}
        {label}
      </td>
      <td className="field-value-cell">
        {editing ? (
          <span className="field-edit-group">
            <input
              ref={inputRef}
              className="field-edit-input"
              type={inputType}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
            />
          </span>
        ) : (
          <span className={`field-display ${showMismatchIcon ? 'field-mismatch' : ''}`} onClick={(e) => {
            if ((e.metaKey || e.ctrlKey) && derivedValue != null) {
              e.preventDefault();
              onSave(String(derivedValue));
              return;
            }
            setEditValue(value); setEditing(true);
          }} title={derivedValue != null ? `\u2318+click → ${formatCurrency(derivedValue)}` : undefined}>
            {displayValue}
            {showMismatchIcon && derivedValue != null && <span className="field-mismatch-hint"> ({formatCurrency(derivedValue)}!)</span>}
          </span>
        )}

        {isConflict && !editing && onResolve && (
          <div className="conflict-resolution">
            <div className="conflict-values">
              <span className="conflict-ai-value">AI suggests: {override!.ai_value_latest}</span>
            </div>
            <div className="conflict-actions">
              <button className="conflict-btn keep-btn" onClick={() => onResolve('keep')}>Keep mine</button>
              <button className="conflict-btn accept-btn" onClick={() => onResolve('accept')}>Accept AI</button>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
};
