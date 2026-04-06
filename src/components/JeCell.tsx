import React, { useState, useRef, useEffect } from 'react';

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
    <td className={`px-1.5 py-[3px] whitespace-nowrap ${isEmpty ? 'text-text-muted' : ''}`}>
      {editing ? (
        <input
          ref={inputRef}
          className="w-[60px] border border-accent rounded-sm bg-bg text-text text-2.75 px-1 py-[1px] font-sans outline-none"
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          placeholder="TK"
        />
      ) : (
        <span className="je-cell-display cursor-pointer px-1 py-[1px] rounded-sm transition-colors" onClick={handleClick}>
          {account || '–'}
        </span>
      )}
    </td>
  );
};
