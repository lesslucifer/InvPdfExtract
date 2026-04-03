import React, { useState, useRef, useEffect } from 'react';
import { FieldOverrideInfo, OverrideStatus } from '../shared/types';

interface Props {
  value: string;
  fieldName: string;
  lineItemId: string;
  override?: FieldOverrideInfo;
  inputType?: 'text' | 'number';
  onSave: (lineItemId: string, fieldName: string, value: string) => void;
  onResolve?: (lineItemId: string, fieldName: string, action: 'keep' | 'accept') => void;
}

export const EditableCell: React.FC<Props> = ({
  value, fieldName, lineItemId, override, inputType = 'text', onSave, onResolve,
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

  const statusIcon = isConflict ? '⚠️' : isLocked ? '🔒' : null;

  return (
    <td className={`editable-cell ${isConflict ? 'cell-conflict' : ''}`}>
      {editing ? (
        <input
          ref={inputRef}
          className="cell-edit-input"
          type={inputType}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
        />
      ) : (
        <span className="cell-display" onClick={() => { setEditValue(value); setEditing(true); }}>
          {statusIcon && <span className="cell-status-icon" title={isConflict ? 'Conflict' : 'Locked'}>{statusIcon}</span>}
          {value || '-'}
        </span>
      )}
      {isConflict && !editing && onResolve && (
        <div className="cell-conflict-resolution">
          <div className="cell-conflict-ai">AI: {override!.ai_value_latest}</div>
          <div className="cell-conflict-actions">
            <button className="conflict-btn keep-btn" onClick={() => onResolve(lineItemId, fieldName, 'keep')}>Keep</button>
            <button className="conflict-btn accept-btn" onClick={() => onResolve(lineItemId, fieldName, 'accept')}>Accept</button>
          </div>
        </div>
      )}
    </td>
  );
};
