import { t } from '../lib/i18n';
import React, { useState } from 'react';
import { VaultFile, FileStatus, ProcessedFileInfo, ErrorLogEntry, JeQueueItem, JeErrorItem } from '../shared/types';
import { StatusIcon } from './StatusIcon';
import { Icons, ICON_SIZE } from '../shared/icons';
import { useOverlayStore } from '../stores';
import { useQueueData, useProcessedData, useErrorData, useSkippedData } from '../lib/queries';
import { useCancelQueueItem, useClearPendingQueue } from '../lib/mutations';
import type { LucideIcon } from 'lucide-react';

type TabId = 'queue' | 'processed' | 'errors' | 'skipped';

const JE_STATUS_ICON_CONFIG: Record<string, { icon: LucideIcon; className: string }> = {
  pending:    { icon: Icons.hourglass, className: 'text-text-muted' },
  processing: { icon: Icons.loader,    className: 'text-accent animate-spin-slow' },
  done:       { icon: Icons.success,   className: 'text-confidence-high' },
  error:      { icon: Icons.error,     className: 'text-confidence-low' },
};

const CONFIDENCE_ROW_CLASSES: Record<'high' | 'medium' | 'low', string> = {
  high:   'text-confidence-high bg-confidence-high/10',
  medium: 'text-confidence-medium bg-confidence-medium/10',
  low:    'text-confidence-low bg-confidence-low/10',
};

function useCopyFeedback(timeout = 1500) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(prev => (prev === id ? null : prev)), timeout);
  };

  return { copiedId, copy };
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

const settingsHeaderClass = 'flex items-center gap-2 px-4 py-3 border-b border-border sticky top-0 bg-bg z-[1]';
const backBtnClass = 'bg-transparent border-none text-text-secondary cursor-pointer px-1.5 py-[2px] rounded inline-flex items-center hover:text-text hover:bg-bg-hover';

export const ProcessingStatusPanel: React.FC = () => {
  const goBack = useOverlayStore(s => s.goBack);
  const [activeTab, setActiveTab] = useState<TabId>('queue');

  const { data: queueData, isLoading: queueLoading } = useQueueData(undefined, { enabled: activeTab === 'queue' });
  const { data: processedFiles = [], isLoading: processedLoading } = useProcessedData(undefined, { enabled: activeTab === 'processed' });
  const { data: errorData, isLoading: errorsLoading } = useErrorData(undefined, { enabled: activeTab === 'errors' });
  const { data: skippedFiles = [], isLoading: skippedLoading } = useSkippedData(undefined, { enabled: activeTab === 'skipped' });

  const queueFiles = queueData?.files ?? [];
  const jeQueueItems = queueData?.jeItems ?? [];
  const errorLogs = errorData?.logs ?? [];
  const jeErrorItems = errorData?.jeErrors ?? [];

  const loading = (activeTab === 'queue' && queueLoading)
    || (activeTab === 'processed' && processedLoading)
    || (activeTab === 'errors' && errorsLoading)
    || (activeTab === 'skipped' && skippedLoading);

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'queue', label: t('queue', 'Queue'), count: queueFiles.length + jeQueueItems.length },
    { id: 'processed', label: t('processed', 'Processed'), count: processedFiles.length },
    { id: 'errors', label: t('errors', 'Errors'), count: errorLogs.length + jeErrorItems.length },
    { id: 'skipped', label: t('skipped', 'Skipped'), count: skippedFiles.length },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className={settingsHeaderClass}>
        <button className={backBtnClass} onClick={goBack} aria-label="Back">
          <Icons.arrowLeft size={ICON_SIZE.MD} />
        </button>
        <span className="text-3.5 font-semibold">{t('processing_status', 'Processing Status')}</span>
      </div>

      <div className="flex gap-0 border-b border-border px-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`bg-transparent border-none border-b-2 text-3 font-medium px-3 py-2 cursor-pointer transition-[color,border-color] flex items-center gap-1.5 ${activeTab === tab.id ? 'text-accent border-accent' : 'text-text-secondary border-transparent hover:text-text'}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`text-2.5 px-[5px] py-[1px] rounded-lg min-w-[16px] text-center ${activeTab === tab.id ? 'bg-accent/15 text-accent' : 'bg-bg-hover text-text-secondary'}`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="px-8 py-8 text-center text-text-muted">{`${t('loading', 'Loading')}...`}</div>
        ) : activeTab === 'queue' ? (
          <QueueTab files={queueFiles} jeItems={jeQueueItems} />
        ) : activeTab === 'processed' ? (
          <ProcessedTab files={processedFiles} />
        ) : activeTab === 'skipped' ? (
          <SkippedTab files={skippedFiles} />
        ) : (
          <ErrorsTab logs={errorLogs} jeErrors={jeErrorItems} />
        )}
      </div>
    </div>
  );
};

const copyAllBtnClass = (copied: boolean) =>
  `bg-transparent border border-border rounded text-text-muted text-2.75 px-2 py-[2px] cursor-pointer transition-[background,color,border-color] ${copied ? 'text-confidence-high border-confidence-high' : 'hover:bg-bg-hover hover:text-text'}`;

const QueueTab: React.FC<{ files: VaultFile[]; jeItems: JeQueueItem[] }> = ({ files, jeItems }) => {
  const pendingFiles = files.filter(f => f.status === FileStatus.Pending);
  const { copiedId, copy } = useCopyFeedback();
  const cancelItem = useCancelQueueItem();
  const clearPending = useClearPendingQueue();

  const formatEntry = (file: VaultFile) =>
    `File: ${file.relative_path} | Status: ${file.status === FileStatus.Processing ? 'Processing' : 'Pending'}`;

  const handleCopyAll = () => {
    const text = files.map(formatEntry).join('\n');
    copy('__all__', text);
  };

  if (files.length === 0 && jeItems.length === 0) {
    return <div className="px-8 py-8 text-center text-text-muted text-3">{t('no_items_in_queue', 'No items in queue')}</div>;
  }
  return (
    <>
      <div className="flex justify-end px-4 py-1 border-b border-border gap-2">
        {pendingFiles.length > 1 && (
          <button
            className="bg-transparent border border-border rounded text-text-muted text-2.75 px-2 py-[2px] cursor-pointer hover:bg-confidence-low hover:text-white hover:border-confidence-low"
            onClick={() => clearPending.mutate()}
          >{`${t('clear_all_pending', 'Clear all pending')} (`}{pendingFiles.length})
          </button>
        )}
        <button className={copyAllBtnClass(copiedId === '__all__')} onClick={handleCopyAll}>
          {copiedId === '__all__' ? `${t('copied', 'Copied')}!` : t('copy_all', 'Copy all')}
        </button>
      </div>
      <ul className="list-none m-0 p-0">
        {files.map(file => (
          <li key={file.id} className="group flex items-center gap-2 px-4 py-1.5 text-3 border-b border-border transition-colors hover:bg-bg-hover">
            <StatusIcon status={file.status} />
            <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-text" title={file.relative_path}>
              {file.relative_path}
            </span>
            <span className="text-2.75 text-text-muted shrink-0">
              {file.status === FileStatus.Processing ? t('processing', 'Processing') : t('pending', 'Pending')}
            </span>
            <span className="text-2.5 text-text-muted shrink-0">{formatTime(file.created_at)}</span>
            <button
              className={`bg-transparent border-none text-text-muted cursor-pointer inline-flex items-center px-1 shrink-0 rounded opacity-0 group-hover:opacity-100 transition-[opacity,color,background] hover:text-text hover:bg-bg-hover ${copiedId === file.id ? '!opacity-100 text-confidence-high' : ''}`}
              onClick={() => copy(file.id, formatEntry(file))}
              title="Copy to clipboard"
            >
              {copiedId === file.id ? <Icons.check size={ICON_SIZE.SM} /> : <Icons.copy size={ICON_SIZE.SM} />}
            </button>
            {file.status === FileStatus.Pending && (
              <button
                className="bg-transparent border-none text-text-muted cursor-pointer inline-flex items-center px-1 shrink-0 opacity-0 group-hover:opacity-100 transition-[opacity,color] hover:text-confidence-low"
                onClick={() => cancelItem.mutate(file.id)}
                title="Remove from queue"
              >
                <Icons.close size={ICON_SIZE.SM} />
              </button>
            )}
          </li>
        ))}
        {jeItems.map(item => (
          <li key={`je-${item.record_id}`} className="group flex items-center gap-2 px-4 py-1.5 text-3 border-b border-border transition-colors hover:bg-bg-hover">
            {(() => { const c = JE_STATUS_ICON_CONFIG[item.je_status]; return c ? <span className={`inline-flex items-center shrink-0 ${c.className}`}><c.icon size={ICON_SIZE.XS} /></span> : null; })()}
            <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-text" title={item.relative_path}>
              {item.description || item.relative_path}
            </span>
            <span className="text-2.75 text-accent shrink-0">
              {item.je_status === 'processing' ? t('classifying', 'Classifying') : t('classification_pending', 'Classification pending')}
            </span>
            <span className="text-2.5 text-text-muted shrink-0">{formatTime(item.created_at)}</span>
          </li>
        ))}
      </ul>
    </>
  );
};

const ProcessedTab: React.FC<{ files: ProcessedFileInfo[] }> = ({ files }) => {
  const { copiedId, copy } = useCopyFeedback();

  const formatEntry = (file: ProcessedFileInfo) =>
    `File: ${file.relative_path} | Records: ${file.record_count} | Confidence: ${Math.round(file.overall_confidence * 100)}%`;

  const handleCopyAll = () => {
    const text = files.map(formatEntry).join('\n');
    copy('__all__', text);
  };

  if (files.length === 0) {
    return <div className="px-8 py-8 text-center text-text-muted text-3">{t('no_processed_files', 'No processed files')}</div>;
  }
  return (
    <>
      <div className="flex justify-end px-4 py-1 border-b border-border">
        <button className={copyAllBtnClass(copiedId === '__all__')} onClick={handleCopyAll}>
          {copiedId === '__all__' ? `${t('copied', 'Copied')}!` : t('copy_all', 'Copy all')}
        </button>
      </div>
      <ul className="list-none m-0 p-0">
        {files.map(file => {
          const confKey = file.overall_confidence >= 0.9 ? 'high' : file.overall_confidence >= 0.7 ? 'medium' : 'low';
          return (
            <li key={file.id} className="group flex items-center gap-2 px-4 py-1.5 text-3 border-b border-border transition-colors hover:bg-bg-hover">
              <StatusIcon status={file.status as FileStatus} />
              <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-text" title={file.relative_path}>
                {file.relative_path}
              </span>
              <span className="text-2.75 text-text-secondary shrink-0">{file.record_count}{` ${t('rec', 'rec')}`}</span>
              <span className={`text-2.75 font-medium shrink-0 px-[5px] py-[1px] rounded ${CONFIDENCE_ROW_CLASSES[confKey]}`}>
                {Math.round(file.overall_confidence * 100)}%
              </span>
              <span className="text-2.5 text-text-muted shrink-0">{formatTime(file.updated_at)}</span>
              <button
                className={`bg-transparent border-none text-text-muted cursor-pointer inline-flex items-center px-1 shrink-0 rounded opacity-0 group-hover:opacity-100 transition-[opacity,color,background] hover:text-text hover:bg-bg-hover ${copiedId === file.id ? '!opacity-100 text-confidence-high' : ''}`}
                onClick={() => copy(file.id, formatEntry(file))}
                title="Copy to clipboard"
              >
                {copiedId === file.id ? <Icons.check size={ICON_SIZE.SM} /> : <Icons.copy size={ICON_SIZE.SM} />}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
};

const SkippedTab: React.FC<{ files: VaultFile[] }> = ({ files }) => {
  if (files.length === 0) {
    return <div className="px-8 py-8 text-center text-text-muted text-3">{t('no_skipped_files', 'No skipped files')}</div>;
  }
  return (
    <ul className="list-none m-0 p-0">
      {files.map(file => (
        <li key={file.id} className="group flex items-start gap-2 px-4 py-2 text-3 border-b border-border transition-colors hover:bg-bg-hover">
          <StatusIcon status={FileStatus.Skipped} />
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-text" title={file.relative_path}>
              {file.relative_path}
            </span>
            {file.filter_reason && (
              <span className="text-2.75 text-text-muted overflow-hidden text-ellipsis whitespace-nowrap" title={file.filter_reason}>
                {file.filter_reason}
              </span>
            )}
            {file.filter_score != null && (
              <span className="text-2.5 text-text-muted">{`${t('score', 'Score')}: `}{Math.round(file.filter_score * 100)}{`% · ${t('layer', 'Layer')} `}{file.filter_layer}
              </span>
            )}
          </div>
          <button
            className="bg-transparent border border-border rounded text-text-muted text-2.75 px-2 py-[2px] cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-[opacity,background,color,border-color] hover:bg-bg-hover hover:text-text"
            onClick={() => window.api.reprocessFile(file.relative_path)}
            title="Force reprocess this file"
          >{t('reprocess', 'Reprocess')}</button>
        </li>
      ))}
    </ul>
  );
};

const ErrorsTab: React.FC<{ logs: ErrorLogEntry[]; jeErrors: JeErrorItem[] }> = ({ logs, jeErrors }) => {
  const { copiedId, copy } = useCopyFeedback();

  const formatEntry = (log: ErrorLogEntry) =>
    `File: ${log.relative_path || 'Unknown file'}\nError: ${log.message}`;

  const handleCopyAll = () => {
    const text = logs.map(formatEntry).join('\n\n');
    copy('__all__', text);
  };

  if (logs.length === 0 && jeErrors.length === 0) {
    return <div className="px-8 py-8 text-center text-text-muted text-3">{t('no_errors', 'No errors')}</div>;
  }
  return (
    <>
      <div className="flex justify-end px-4 py-1 border-b border-border">
        <button className={copyAllBtnClass(copiedId === '__all__')} onClick={handleCopyAll}>
          {copiedId === '__all__' ? `${t('copied', 'Copied')}!` : t('copy_all', 'Copy all')}
        </button>
      </div>
      <ul className="list-none m-0 p-0">
        {logs.map(log => (
          <li key={log.id} className="group flex items-start gap-2 px-4 py-1.5 text-3 border-b border-border transition-colors hover:bg-bg-hover">
            <StatusIcon status={FileStatus.Error} />
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-text" title={log.relative_path || 'Unknown file'}>
                {log.relative_path || t('unknown_file', 'Unknown file')}
              </span>
              <span className="text-2.75 text-confidence-low overflow-hidden text-ellipsis whitespace-nowrap" title={log.message}>
                {log.message}
              </span>
            </div>
            <span className="text-2.5 text-text-muted shrink-0">{formatTime(log.timestamp)}</span>
            <button
              className={`bg-transparent border-none text-text-muted cursor-pointer inline-flex items-center px-1 shrink-0 rounded opacity-0 group-hover:opacity-100 transition-[opacity,color,background] hover:text-text hover:bg-bg-hover ${copiedId === log.id ? '!opacity-100 text-confidence-high' : ''}`}
              onClick={() => copy(log.id, formatEntry(log))}
              title="Copy to clipboard"
            >
              {copiedId === log.id ? <Icons.check size={ICON_SIZE.SM} /> : <Icons.copy size={ICON_SIZE.SM} />}
            </button>
          </li>
        ))}
        {jeErrors.map(item => (
          <li key={`je-err-${item.record_id}`} className="group flex items-start gap-2 px-4 py-1.5 text-3 border-b border-border transition-colors hover:bg-bg-hover">
            <span className={`inline-flex items-center shrink-0 ${JE_STATUS_ICON_CONFIG['error'].className}`}><Icons.error size={ICON_SIZE.XS} /></span>
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-text" title={item.relative_path}>
                {item.description || item.relative_path}
              </span>
              <span className="text-2.75 text-confidence-low">{t('classification_failed', 'Classification failed')}</span>
            </div>
            <span className="text-2.5 text-text-muted shrink-0">{formatTime(item.updated_at)}</span>
          </li>
        ))}
      </ul>
    </>
  );
};
