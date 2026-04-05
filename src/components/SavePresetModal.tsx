import React, { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  visible: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}

export const SavePresetModal: React.FC<Props> = ({ visible, onSave, onCancel }) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      setName('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [visible]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter' && name.trim()) {
      onSave(name.trim());
    } else if (e.key === 'Escape') {
      onCancel();
    }
  }, [name, onSave, onCancel]);

  if (!visible) return null;

  return (
    <div className="save-preset-backdrop" onClick={onCancel}>
      <div className="save-preset-modal" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="save-preset-modal__title">Save Filter Preset</div>
        <input
          ref={inputRef}
          className="save-preset-modal__input"
          type="text"
          placeholder="Preset name..."
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <div className="save-preset-modal__buttons">
          <button className="save-preset-modal__cancel" onClick={onCancel}>Cancel</button>
          <button className="save-preset-modal__save" onClick={() => name.trim() && onSave(name.trim())} disabled={!name.trim()}>Save</button>
        </div>
      </div>
    </div>
  );
};
