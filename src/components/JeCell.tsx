import React, { useState, useRef, useEffect } from 'react';

// === JeCell — inline-editable <td> for a single account code ===

interface JeCellProps {
  account: string | null;
  onSave: (account: string) => void;
}

export const JeCell: React.FC<JeCellProps> = ({ account, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(account ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== (account ?? '')) {
      onSave(trimmed);
    }
    setEditing(false);
  };

  const handleClick = () => {
    setEditValue(account ?? '');
    setEditing(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setEditValue(account ?? '');
      setEditing(false);
    }
  };

  const isEmpty = !account;

  return (
    <td className={`je-cell ${isEmpty ? 'je-cell-empty' : ''}`}>
      {editing ? (
        <input
          ref={inputRef}
          className="je-cell-input"
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          placeholder="TK"
        />
      ) : (
        <span className="je-cell-display" onClick={handleClick}>
          {account || '–'}
        </span>
      )}
    </td>
  );
};
