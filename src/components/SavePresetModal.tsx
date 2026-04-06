import { t } from '../lib/i18n';
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]" onClick={onCancel}>
      <div
        className="bg-bg-secondary border border-border rounded-xl px-5 py-4 w-80 shadow-modal"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="text-3.5 font-semibold text-text mb-3">{t('save_filter_preset', 'Save Filter Preset')}</div>
        <input
          ref={inputRef}
          className="w-full px-2.5 py-2 text-3.25 border border-border rounded-md bg-bg text-text outline-none focus:border-accent placeholder:text-text-muted"
          type="text"
          placeholder="Preset name..."
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <div className="flex justify-end gap-2 mt-3">
          <button
            className="px-3.5 py-1.5 text-3 border-none rounded-md cursor-pointer transition-colors bg-bg-hover text-text-secondary hover:bg-border"
            onClick={onCancel}
          >{t('cancel', 'Cancel')}</button>
          <button
            className="px-3.5 py-1.5 text-3 border-none rounded-md cursor-pointer bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-default"
            onClick={() => name.trim() && onSave(name.trim())}
            disabled={!name.trim()}
          >{t('save', 'Save')}</button>
        </div>
      </div>
    </div>
  );
};
