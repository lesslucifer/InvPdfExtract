import React, { useState, useRef, useEffect } from 'react';
import { t } from '../lib/i18n';

interface JeCellProps {
  account: string | null;
  contraAccount?: string | null;
  onSave: (account: string, contraAccount?: string) => void;
}

interface EditableTkProps {
  value: string | null;
  placeholder: string;
  onSave: (value: string) => void;
}

const EditableTk: React.FC<EditableTkProps> = ({ value, placeholder, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== (value ?? '')) {
      onSave(trimmed);
    }
    setEditing(false);
  };

  const handleClick = () => {
    setEditValue(value ?? '');
    setEditing(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.stopPropagation();
      handleSave();
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      setEditValue(value ?? '');
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="w-[60px] border border-accent rounded-sm bg-bg text-text text-2.75 px-1 py-[1px] font-sans outline-none"
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        placeholder={placeholder}
      />
    );
  }

  return (
    <span
      className={`je-cell-display cursor-pointer px-1 py-[1px] rounded-sm transition-colors${!value ? ' text-text-muted' : ''}`}
      onClick={handleClick}
    >
      {value || '–'}
    </span>
  );
};

export const JeCell: React.FC<JeCellProps> = ({ account, contraAccount, onSave }) => {
  const showContra = contraAccount !== undefined;

  return (
    <td className="px-1.5 py-[3px] whitespace-nowrap">
      <div className="flex items-center gap-1">
        <EditableTk
          value={account}
          placeholder={t('tk_placeholder', 'TK')}
          onSave={(acc) => onSave(acc, contraAccount ?? undefined)}
        />
        {showContra && (
          <>
            <span className="text-text-muted text-2.5">/</span>
            <EditableTk
              value={contraAccount ?? null}
              placeholder={t('tk_du_placeholder', 'TK ĐƯ')}
              onSave={(contra) => onSave(account ?? '', contra)}
            />
          </>
        )}
      </div>
    </td>
  );
};
