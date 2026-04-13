import React, { useState, useRef, useEffect, useCallback } from 'react';
import { t } from '../lib/i18n';
import { Icons, ICON_SIZE } from '../shared/icons';

interface Props {
  fileName: string;
  onReprocess: () => void;
  onReanalyze: (hint: string) => void;
  onCancel: () => void;
}

export const ReanalyzePrompt: React.FC<Props> = ({ fileName, onReprocess, onReanalyze, onCancel }) => {
  const [hint, setHint] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onCancel]);

  const handleSubmit = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    if (hint.trim()) {
      onReanalyze(hint.trim());
    } else {
      onReprocess();
    }
  }, [hint, submitting, onReprocess, onReanalyze]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const hasHint = hint.trim().length > 0;

  if (submitting) {
    return (
      <div className="flex items-center justify-center gap-1.5 px-4 py-3 bg-bg-secondary border-b border-border text-3 text-text-secondary animate-status-pulse">
        {hasHint && <Icons.sparkles size={ICON_SIZE.SM} />}
        {hasHint ? t('reanalyzing', 'Re-analyzing...') : t('processing_file', 'Processing...')}
      </div>
    );
  }

  return (
    <div className="px-3 py-2 bg-bg-secondary border-b border-border">
      <div className="flex items-center gap-1.5 mb-1 text-2.75 text-text-secondary truncate">
        <span>{t('reprocess_file_label', 'Reprocess')}</span>
        <span className="font-medium text-text truncate" title={fileName}>{fileName}</span>
      </div>
      <div className="text-2.5 text-text-muted mb-1.5">
        {t('reanalyze_hint', 'Results not right? Describe the problem and AI will re-extract with your feedback')}
      </div>
      <textarea
        ref={inputRef}
        className="w-full px-2.5 py-1.5 bg-bg border border-border rounded text-3 text-text resize-none placeholder:text-text-muted focus:outline-none focus:border-accent"
        rows={2}
        placeholder={t('reanalyze_placeholder', 'e.g. wrong column mapped, tax rate shown as text, missing line items...')}
        value={hint}
        onChange={(e) => setHint(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="flex justify-end items-center gap-2 mt-1.5">
        <button
          className="px-2.5 py-1 border-none rounded text-2.75 cursor-pointer bg-transparent text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
          onClick={onCancel}
        >
          {t('cancel', 'Cancel')}
        </button>
        {hasHint ? (
          <button
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 border-none rounded text-3 font-medium cursor-pointer bg-accent text-white hover:brightness-110 transition-colors"
            onClick={handleSubmit}
          >
            <Icons.sparkles size={ICON_SIZE.SM} />
            {t('reanalyze', 'Re-analyze')}
          </button>
        ) : (
          <button
            className="px-3 py-1 border border-border rounded text-2.75 cursor-pointer bg-bg text-text hover:bg-bg-hover transition-colors"
            onClick={handleSubmit}
          >
            {t('reprocess', 'Reprocess')}
          </button>
        )}
      </div>
    </div>
  );
};
