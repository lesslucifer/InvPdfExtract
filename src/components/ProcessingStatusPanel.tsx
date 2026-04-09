import { t } from '../lib/i18n';
import React, { useState } from 'react';
import { VaultFile, FileStatus, ProcessedFileInfo, ErrorLogEntry, JeQueueItem, JeErrorItem } from '../shared/types';
import { StatusIcon } from './StatusIcon';
import { Icons, ICON_SIZE } from '../shared/icons';
import { useOverlayStore } from '../stores';
import { useQueueData, useProcessedData, useErrorData, useSkippedData } from '../lib/queries';
import { useCancelQueueItem, useClearPendingQueue } from '../lib/mutations';
import { formatTime, formatDuration, formatStaticDuration } from '../shared/timeUtils';
import { useLiveDuration } from '../hooks/useLiveDuration';
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

const settingsHeaderClass = 'flex items-center gap-2 px-4 py-3 border-b border-border sticky top-0 bg-bg z-[1]';
const backBtnClass = 'bg-transparent border-none text-text-secondary cursor-pointer px-1.5 py-[2px] rounded inline-flex items-center hover:text-text hover:bg-bg-hover';

const FileLink: React.FC<{ relativePath: string; className?: string }> = ({ relativePath, className = '' }) => (
  <button
    className={`bg-transparent border-none p-0 text-left cursor-pointer text-accent hover:underline overflow-hidden text-ellipsis whitespace-nowrap min-w-0 ${className}`}
    title={`${relativePath}\n${t('locate_in_file_manager', 'Locate in file manager')}`}
    onClick={e => { e.stopPropagation(); window.api.locateFile(relativePath); }}
  >
    {relativePath}
  </button>
);

export const ProcessingStatusPanel: React.FC = () => {
  const goBack = useOverlayStore(s => s.goBack);
  const [activeTab, setActiveTab] = useState<TabId>('queue');

  const { data: queueData, isLoading: queueLoading } = useQueueData();
  const { data: processedFiles = [], isLoading: processedLoading } = useProcessedData();
  const { data: errorData, isLoading: errorsLoading } = useErrorData();
  const { data: skippedFiles = [], isLoading: skippedLoading } = useSkippedData();

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
        <button className={backBtnClass} onClick={goBack} aria-label={t('back', 'Back')}>
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
  const hasActive = files.some(f => f.status === FileStatus.Processing) || jeItems.some(j => j.je_status === 'processing');
  useLiveDuration(hasActive);
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
            <FileLink relativePath={file.relative_path} className="flex-1 text-3 text-text" />
            <span className="text-2.75 text-text-muted shrink-0">
              {file.status === FileStatus.Processing ? t('processing', 'Processing') : t('pending', 'Pending')}
            </span>
            {file.status === FileStatus.Processing && file.processing_started_at ? (
              <span className="text-2.5 text-accent shrink-0 font-mono" title={t('elapsed', 'Elapsed')}>
                {formatDuration(file.processing_started_at)}
              </span>
            ) : (
              <span className="text-2.5 text-text-muted shrink-0">{formatTime(file.created_at)}</span>
            )}
            <button
              className={`bg-transparent border-none text-text-muted cursor-pointer inline-flex items-center px-1 shrink-0 rounded opacity-0 group-hover:opacity-100 transition-[opacity,color,background] hover:text-text hover:bg-bg-hover ${copiedId === file.id ? '!opacity-100 text-confidence-high' : ''}`}
              onClick={() => copy(file.id, formatEntry(file))}
              title={t('copy_to_clipboard', 'Copy to clipboard')}
            >
              {copiedId === file.id ? <Icons.check size={ICON_SIZE.SM} /> : <Icons.copy size={ICON_SIZE.SM} />}
            </button>
            {file.status === FileStatus.Pending && (
              <button
                className="bg-transparent border-none text-text-muted cursor-pointer inline-flex items-center px-1 shrink-0 opacity-0 group-hover:opacity-100 transition-[opacity,color] hover:text-confidence-low"
                onClick={() => cancelItem.mutate(file.id)}
                title={t('remove_from_queue', 'Remove from queue')}
              >
                <Icons.close size={ICON_SIZE.SM} />
              </button>
            )}
          </li>
        ))}
        {jeItems.map(item => (
          <li key={`je-${item.record_id}`} className="group flex items-center gap-2 px-4 py-1.5 text-3 border-b border-border transition-colors hover:bg-bg-hover">
            {(() => { const c = JE_STATUS_ICON_CONFIG[item.je_status]; return c ? <span className={`inline-flex items-center shrink-0 ${c.className}`}><c.icon size={ICON_SIZE.XS} /></span> : null; })()}
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="text-3 text-text overflow-hidden text-ellipsis whitespace-nowrap">
                {item.description || item.relative_path}
              </span>
              {item.description && (
                <FileLink relativePath={item.relative_path} className="text-2.75 text-text-muted" />
              )}
            </div>
            <span className="text-2.75 text-accent shrink-0">
              {item.je_status === 'processing' ? t('generating_je', 'Generating JE') : t('je_generation_pending', 'JE generation pending')}
            </span>
            {item.je_status === 'processing' && item.je_processing_started_at ? (
              <span className="text-2.5 text-accent shrink-0 font-mono" title={t('elapsed', 'Elapsed')}>
                {formatDuration(item.je_processing_started_at)}
              </span>
            ) : (
              <span className="text-2.5 text-text-muted shrink-0">{formatTime(item.created_at)}</span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
};

const ProcessedTab: React.FC<{ files: ProcessedFileInfo[] }> = ({ files }) => {
  const { copiedId, copy } = useCopyFeedback();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sessionLogs, setSessionLogs] = useState<Record<string, string | null>>({});

  const formatEntry = (file: ProcessedFileInfo) =>
    `File: ${file.relative_path} | Records: ${file.record_count} | Confidence: ${Math.round(file.overall_confidence * 100)}%`;

  const handleCopyAll = () => {
    const text = files.map(formatEntry).join('\n');
    copy('__all__', text);
  };

  const handleToggleLog = async (fileId: string) => {
    if (expandedId === fileId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(fileId);
    if (!(fileId in sessionLogs)) {
      const log = await window.api.getSessionLogForFile(fileId);
      setSessionLogs(prev => ({ ...prev, [fileId]: log }));
    }
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
          const isExpanded = expandedId === file.id;
          const sessionLog = sessionLogs[file.id];
          return (
            <li key={file.id} className="border-b border-border">
              <div className="group flex items-center gap-2 px-4 py-1.5 text-3 transition-colors hover:bg-bg-hover">
                <StatusIcon status={file.status as FileStatus} />
                <FileLink relativePath={file.relative_path} className="flex-1 text-3 text-text" />
                <span className="text-2.75 text-text-secondary shrink-0">{file.record_count} {t('rec', 'rec')}</span>
                <span className={`text-2.75 font-medium shrink-0 px-[5px] py-[1px] rounded ${CONFIDENCE_ROW_CLASSES[confKey]}`}>
                  {Math.round(file.overall_confidence * 100)}%
                </span>
                {file.processing_started_at && (
                  <span className="text-2.5 text-text-muted shrink-0 font-mono" title={t('duration', 'Duration')}>
                    {formatStaticDuration(file.processing_started_at, file.updated_at)}
                  </span>
                )}
                <span className="text-2.5 text-text-muted shrink-0">{formatTime(file.updated_at)}</span>
                <button
                  className={`bg-transparent border-none text-text-muted cursor-pointer inline-flex items-center px-1 shrink-0 rounded opacity-0 group-hover:opacity-100 transition-[opacity,color,background] hover:text-text hover:bg-bg-hover ${copiedId === file.id ? '!opacity-100 text-confidence-high' : ''}`}
                  onClick={() => copy(file.id, formatEntry(file))}
                  title={t('copy_to_clipboard', 'Copy to clipboard')}
                >
                  {copiedId === file.id ? <Icons.check size={ICON_SIZE.SM} /> : <Icons.copy size={ICON_SIZE.SM} />}
                </button>
                <button
                  className="bg-transparent border-none text-text-muted cursor-pointer inline-flex items-center px-1 shrink-0 rounded opacity-0 group-hover:opacity-100 transition-[opacity,color,background] hover:text-text hover:bg-bg-hover"
                  onClick={() => handleToggleLog(file.id)}
                  title={t('view_session_log', 'View session log')}
                >
                  {isExpanded ? <Icons.arrowUp size={ICON_SIZE.SM} /> : <Icons.arrowDown size={ICON_SIZE.SM} />}
                </button>
              </div>
              {isExpanded && (
                <div className="px-4 py-2 bg-bg-hover">
                  {sessionLog === undefined ? (
                    <span className="text-2.75 text-text-muted">{`${t('loading', 'Loading')}...`}</span>
                  ) : sessionLog === null ? (
                    <span className="text-2.75 text-text-muted">{t('no_session_log_available', 'No session log available')}</span>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-2.75 text-text-secondary">{t('session_log', 'Session log')}</span>
                        <button
                          className={copyAllBtnClass(copiedId === `log-${file.id}`)}
                          onClick={() => copy(`log-${file.id}`, sessionLog)}
                        >
                          {copiedId === `log-${file.id}` ? `${t('copied', 'Copied')}!` : t('copy_log', 'Copy log')}
                        </button>
                      </div>
                      <pre className="text-2.75 text-text whitespace-pre-wrap break-all bg-bg rounded p-2 max-h-48 overflow-y-auto m-0">
                        {sessionLog}
                      </pre>
                    </>
                  )}
                </div>
              )}
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
            <FileLink relativePath={file.relative_path} className="text-3 text-text" />
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
            title={t('force_reprocess_this_file', 'Force reprocess this file')}
          >{t('reprocess', 'Reprocess')}</button>
        </li>
      ))}
    </ul>
  );
};

interface ParsedErrorDetail {
  exitCode: number | null;
  stderr: string | null;
  partialStdout: string | null;
  sessionLogPath: string | null;
}

function parseDetail(detail: string | null): ParsedErrorDetail | null {
  if (!detail) return null;
  try { return JSON.parse(detail); } catch { return null; }
}

function buildDiagnosticText(log: ErrorLogEntry, detail: ParsedErrorDetail | null, sessionLogContent: string | null): string {
  const lines = [
    `${t('file', 'File')}: ${log.relative_path || t('unknown_file', 'Unknown file')}`,
    `${t('time', 'Time')}: ${log.timestamp}`,
    `${t('error', 'Error')}: ${log.message}`,
  ];
  if (detail) {
    if (detail.exitCode != null) lines.push(`${t('exit_code', 'Exit code')}: ${detail.exitCode}`);
    if (detail.stderr) lines.push(`\n${t('stderr', 'Stderr')}:\n${detail.stderr}`);
    if (detail.partialStdout) lines.push(`\n${t('partial_stdout', 'Partial stdout')}:\n${detail.partialStdout}`);
    if (detail.sessionLogPath) lines.push(`\n${t('session_log_path', 'Session log path')}: ${detail.sessionLogPath}`);
  }
  if (sessionLogContent) lines.push(`\n${t('session_log', 'Session log')}:\n${sessionLogContent}`);
  return lines.join('\n');
}

const ErrorsTab: React.FC<{ logs: ErrorLogEntry[]; jeErrors: JeErrorItem[] }> = ({ logs, jeErrors }) => {
  const { copiedId, copy } = useCopyFeedback();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sessionLogContents, setSessionLogContents] = useState<Record<string, string | null>>({});

  const formatEntry = (log: ErrorLogEntry) =>
    `${t('file', 'File')}: ${log.relative_path || t('unknown_file', 'Unknown file')}\n${t('error', 'Error')}: ${log.message}`;

  const handleCopyAll = () => {
    const text = logs.map(formatEntry).join('\n\n');
    copy('__all__', text);
  };

  const handleToggle = (logId: string) => {
    setExpandedId(prev => prev === logId ? null : logId);
  };

  const handleLoadSessionLog = async (logId: string, sessionLogPath: string) => {
    if (logId in sessionLogContents) return;
    const content = await window.api.readCliSessionLog(sessionLogPath);
    setSessionLogContents(prev => ({ ...prev, [logId]: content }));
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
        {logs.map(log => {
          const detail = parseDetail(log.detail);
          const isExpanded = expandedId === log.id;
          const sessionLogContent = sessionLogContents[log.id];
          return (
            <li key={log.id} className="border-b border-border">
              <div
                className="group flex items-start gap-2 px-4 py-1.5 text-3 transition-colors hover:bg-bg-hover cursor-pointer"
                onClick={() => handleToggle(log.id)}
              >
                <StatusIcon status={FileStatus.Error} />
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  {log.relative_path ? (
                    <FileLink relativePath={log.relative_path} className="text-3 text-text" />
                  ) : (
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-text-muted">
                      {t('unknown_file', 'Unknown file')}
                    </span>
                  )}
                  <span className="text-2.75 text-confidence-low overflow-hidden text-ellipsis whitespace-nowrap" title={log.message}>
                    {log.message}
                  </span>
                </div>
                <span className="text-2.5 text-text-muted shrink-0">{formatTime(log.timestamp)}</span>
                <button
                  className={`bg-transparent border-none text-text-muted cursor-pointer inline-flex items-center px-1 shrink-0 rounded opacity-0 group-hover:opacity-100 transition-[opacity,color,background] hover:text-text hover:bg-bg-hover ${copiedId === log.id ? '!opacity-100 text-confidence-high' : ''}`}
                  onClick={e => { e.stopPropagation(); copy(log.id, formatEntry(log)); }}
                  title={t('copy_to_clipboard', 'Copy to clipboard')}
                >
                  {copiedId === log.id ? <Icons.check size={ICON_SIZE.SM} /> : <Icons.copy size={ICON_SIZE.SM} />}
                </button>
                <span className="text-text-muted inline-flex items-center shrink-0 opacity-0 group-hover:opacity-100">
                  {isExpanded ? <Icons.arrowUp size={ICON_SIZE.SM} /> : <Icons.arrowDown size={ICON_SIZE.SM} />}
                </span>
              </div>
              {isExpanded && (
                <div className="px-4 py-2 bg-bg-hover flex flex-col gap-2">
                  <pre className="text-2.75 text-text whitespace-pre-wrap break-all bg-bg rounded p-2 max-h-32 overflow-y-auto m-0">
                    {log.message}
                  </pre>
                  {detail && (
                    <>
                      {detail.exitCode != null && (
                        <span className="text-2.75 text-text-secondary">{t('exit_code', 'Exit code')}: <span className="text-confidence-low font-mono">{detail.exitCode}</span></span>
                      )}
                      {detail.stderr && (
                        <>
                          <span className="text-2.75 text-text-secondary">{t('stderr', 'Stderr')}:</span>
                          <pre className="text-2.75 text-text whitespace-pre-wrap break-all bg-bg rounded p-2 max-h-32 overflow-y-auto m-0">{detail.stderr}</pre>
                        </>
                      )}
                      {detail.partialStdout && (
                        <>
                          <span className="text-2.75 text-text-secondary">{t('partial_stdout', 'Partial stdout')}:</span>
                          <pre className="text-2.75 text-text whitespace-pre-wrap break-all bg-bg rounded p-2 max-h-32 overflow-y-auto m-0">{detail.partialStdout}</pre>
                        </>
                      )}
                      {detail.sessionLogPath && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-2.75 text-text-secondary font-mono overflow-hidden text-ellipsis whitespace-nowrap flex-1" title={detail.sessionLogPath}>
                            {detail.sessionLogPath}
                          </span>
                          <button
                            className={copyAllBtnClass(copiedId === `path-${log.id}`)}
                            onClick={() => copy(`path-${log.id}`, detail.sessionLogPath!)}
                          >
                            {copiedId === `path-${log.id}` ? `${t('copied', 'Copied')}!` : t('copy_path', 'Copy path')}
                          </button>
                          {!(log.id in sessionLogContents) && (
                            <button
                              className="bg-transparent border border-border rounded text-text-muted text-2.75 px-2 py-[2px] cursor-pointer hover:bg-bg hover:text-text"
                              onClick={() => handleLoadSessionLog(log.id, detail.sessionLogPath!)}
                            >
                              {t('load_log', 'Load log')}
                            </button>
                          )}
                        </div>
                      )}
                      {log.id in sessionLogContents && (
                        sessionLogContent === null ? (
                          <span className="text-2.75 text-text-muted">{t('session_log_file_not_found', 'Session log file not found')}</span>
                        ) : (
                          <>
                            <span className="text-2.75 text-text-secondary">{t('session_log', 'Session log')}:</span>
                            <pre className="text-2.75 text-text whitespace-pre-wrap break-all bg-bg rounded p-2 max-h-48 overflow-y-auto m-0">{sessionLogContent}</pre>
                          </>
                        )
                      )}
                    </>
                  )}
                  <div className="flex justify-end">
                    <button
                      className={copyAllBtnClass(copiedId === `diag-${log.id}`)}
                      onClick={() => copy(`diag-${log.id}`, buildDiagnosticText(log, detail, sessionLogContent ?? null))}
                    >
                      {copiedId === `diag-${log.id}` ? `${t('copied', 'Copied')}!` : t('copy_diagnostic_info', 'Copy diagnostic info')}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {jeErrors.map(item => (
          <li key={`je-err-${item.record_id}`} className="group flex items-start gap-2 px-4 py-1.5 text-3 border-b border-border transition-colors hover:bg-bg-hover">
            <span className={`inline-flex items-center shrink-0 ${JE_STATUS_ICON_CONFIG['error'].className}`}><Icons.error size={ICON_SIZE.XS} /></span>
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="text-3 text-text overflow-hidden text-ellipsis whitespace-nowrap">
                {item.description || item.relative_path}
              </span>
              {item.description && (
                <FileLink relativePath={item.relative_path} className="text-2.75 text-text-muted" />
              )}
              <span className="text-2.75 text-confidence-low">{t('je_generation_failed', 'JE generation failed')}</span>
            </div>
            {item.je_processing_started_at && (
              <span className="text-2.5 text-text-muted shrink-0 font-mono" title={t('duration', 'Duration')}>
                {formatStaticDuration(item.je_processing_started_at, item.updated_at)}
              </span>
            )}
            <span className="text-2.5 text-text-muted shrink-0">{formatTime(item.updated_at)}</span>
          </li>
        ))}
      </ul>
    </>
  );
};
