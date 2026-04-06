import React, { useState, useEffect } from 'react';
import { VaultFile, FileStatus, ProcessedFileInfo, ErrorLogEntry, JeQueueItem, JeErrorItem } from '../shared/types';
import { StatusDot } from './StatusDot';
import { Icons, ICON_SIZE } from '../shared/icons';

type TabId = 'queue' | 'processed' | 'errors';

interface Props {
  onBack: () => void;
}

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

export const ProcessingStatusPanel: React.FC<Props> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<TabId>('queue');
  const [queueFiles, setQueueFiles] = useState<VaultFile[]>([]);
  const [jeQueueItems, setJeQueueItems] = useState<JeQueueItem[]>([]);
  const [processedFiles, setProcessedFiles] = useState<ProcessedFileInfo[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>([]);
  const [jeErrorItems, setJeErrorItems] = useState<JeErrorItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTab = async (tab: TabId) => {
    if (tab === 'queue') {
      const [files, jeItems] = await Promise.all([
        window.api.getFilesByStatuses([FileStatus.Pending, FileStatus.Processing]),
        window.api.getJeQueueItems(),
      ]);
      setQueueFiles(files);
      setJeQueueItems(jeItems);
    } else if (tab === 'processed') {
      const files = await window.api.getProcessedFilesWithStats();
      setProcessedFiles(files);
    } else {
      const [logs, jeErrors] = await Promise.all([
        window.api.getErrorLogsWithPath(),
        window.api.getJeErrorItems(),
      ]);
      setErrorLogs(logs);
      setJeErrorItems(jeErrors);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    loadTab(activeTab)
      .catch(err => console.error('[ProcessingStatusPanel] Load failed:', err))
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [activeTab]);

  // Subscribe to real-time updates to refresh the active tab
  useEffect(() => {
    const unsubFile = window.api.onFileStatusChanged(async () => {
      try { await loadTab(activeTab); } catch { /* ignore */ }
    });
    const unsubJe = window.api.onJeStatusChanged(async () => {
      try { await loadTab(activeTab); } catch { /* ignore */ }
    });
    return () => { unsubFile(); unsubJe(); };
  }, [activeTab]);

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'queue', label: 'Queue', count: queueFiles.length + jeQueueItems.length },
    { id: 'processed', label: 'Processed', count: processedFiles.length },
    { id: 'errors', label: 'Errors', count: errorLogs.length + jeErrorItems.length },
  ];

  return (
    <div className="processing-status-panel">
      <div className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Back">
          <Icons.arrowLeft size={ICON_SIZE.MD} />
        </button>
        <span className="settings-title">Processing Status</span>
      </div>

      <div className="processing-status-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`processing-status-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.count > 0 && <span className="processing-status-tab-count">{tab.count}</span>}
          </button>
        ))}
      </div>

      <div className="processing-status-content">
        {loading ? (
          <div className="settings-loading">Loading...</div>
        ) : activeTab === 'queue' ? (
          <QueueTab files={queueFiles} jeItems={jeQueueItems} onRefresh={() => loadTab('queue')} />
        ) : activeTab === 'processed' ? (
          <ProcessedTab files={processedFiles} />
        ) : (
          <ErrorsTab logs={errorLogs} jeErrors={jeErrorItems} />
        )}
      </div>
    </div>
  );
};

const QueueTab: React.FC<{ files: VaultFile[]; jeItems: JeQueueItem[]; onRefresh: () => Promise<void> }> = ({ files, jeItems, onRefresh }) => {
  const pendingFiles = files.filter(f => f.status === FileStatus.Pending);
  const { copiedId, copy } = useCopyFeedback();

  const formatEntry = (file: VaultFile) =>
    `File: ${file.relative_path} | Status: ${file.status === FileStatus.Processing ? 'Processing' : 'Pending'}`;

  const handleCopyAll = () => {
    const text = files.map(formatEntry).join('\n');
    copy('__all__', text);
  };

  const handleCancel = async (fileId: string) => {
    await window.api.cancelQueueItem(fileId);
    await onRefresh();
  };

  const handleClearAll = async () => {
    await window.api.clearPendingQueue();
    await onRefresh();
  };

  if (files.length === 0 && jeItems.length === 0) {
    return <div className="processing-status-empty">No items in queue</div>;
  }
  return (
    <>
      <div className="processing-queue-actions">
        {pendingFiles.length > 1 && (
          <button className="processing-queue-clear-btn" onClick={handleClearAll}>
            Clear all pending ({pendingFiles.length})
          </button>
        )}
        <button
          className={`processing-status-copy-all-btn${copiedId === '__all__' ? ' copied' : ''}`}
          onClick={handleCopyAll}
        >
          {copiedId === '__all__' ? 'Copied!' : 'Copy all'}
        </button>
      </div>
      <ul className="processing-status-list">
        {files.map(file => (
          <li key={file.id} className="processing-status-row">
            <StatusDot status={file.status} />
            <span className="processing-status-path" title={file.relative_path}>
              {file.relative_path}
            </span>
            <span className="processing-status-label">
              {file.status === FileStatus.Processing ? 'Processing' : 'Pending'}
            </span>
            <span className="processing-status-time">{formatTime(file.created_at)}</span>
            <button
              className={`processing-status-copy-btn${copiedId === file.id ? ' copied' : ''}`}
              onClick={() => copy(file.id, formatEntry(file))}
              title="Copy to clipboard"
            >
              {copiedId === file.id ? <Icons.check size={ICON_SIZE.SM} /> : <Icons.copy size={ICON_SIZE.SM} />}
            </button>
            {file.status === FileStatus.Pending && (
              <button
                className="processing-queue-cancel-btn"
                onClick={() => handleCancel(file.id)}
                title="Remove from queue"
              >
                <Icons.close size={ICON_SIZE.SM} />
              </button>
            )}
          </li>
        ))}
        {jeItems.map(item => (
          <li key={`je-${item.record_id}`} className="processing-status-row processing-status-row--je">
            <span className={`je-status-dot je-status-dot--${item.je_status}`} />
            <span className="processing-status-path" title={item.relative_path}>
              {item.description || item.relative_path}
            </span>
            <span className="processing-status-label processing-status-label--je">
              {item.je_status === 'processing' ? 'Classifying' : 'Classification pending'}
            </span>
            <span className="processing-status-time">{formatTime(item.created_at)}</span>
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
    return <div className="processing-status-empty">No processed files</div>;
  }
  return (
    <>
      <div className="processing-queue-actions">
        <button
          className={`processing-status-copy-all-btn${copiedId === '__all__' ? ' copied' : ''}`}
          onClick={handleCopyAll}
        >
          {copiedId === '__all__' ? 'Copied!' : 'Copy all'}
        </button>
      </div>
      <ul className="processing-status-list">
        {files.map(file => (
          <li key={file.id} className="processing-status-row">
            <StatusDot status={file.status as FileStatus} />
            <span className="processing-status-path" title={file.relative_path}>
              {file.relative_path}
            </span>
            <span className="processing-status-meta">
              {file.record_count} rec
            </span>
            <span className={`processing-status-confidence ${file.overall_confidence >= 0.9 ? 'high' : file.overall_confidence >= 0.7 ? 'medium' : 'low'}`}>
              {Math.round(file.overall_confidence * 100)}%
            </span>
            <span className="processing-status-time">{formatTime(file.updated_at)}</span>
            <button
              className={`processing-status-copy-btn${copiedId === file.id ? ' copied' : ''}`}
              onClick={() => copy(file.id, formatEntry(file))}
              title="Copy to clipboard"
            >
              {copiedId === file.id ? <Icons.check size={ICON_SIZE.SM} /> : <Icons.copy size={ICON_SIZE.SM} />}
            </button>
          </li>
        ))}
      </ul>
    </>
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
    return <div className="processing-status-empty">No errors</div>;
  }
  return (
    <>
      <div className="processing-queue-actions">
        <button
          className={`processing-status-copy-all-btn${copiedId === '__all__' ? ' copied' : ''}`}
          onClick={handleCopyAll}
        >
          {copiedId === '__all__' ? 'Copied!' : 'Copy all'}
        </button>
      </div>
      <ul className="processing-status-list">
        {logs.map(log => (
          <li key={log.id} className="processing-status-row processing-status-row--error">
            <StatusDot status={FileStatus.Error} />
            <div className="processing-status-error-info">
              <span className="processing-status-path" title={log.relative_path || 'Unknown file'}>
                {log.relative_path || 'Unknown file'}
              </span>
              <span className="processing-status-error-msg" title={log.message}>
                {log.message}
              </span>
            </div>
            <span className="processing-status-time">{formatTime(log.timestamp)}</span>
            <button
              className={`processing-status-copy-btn${copiedId === log.id ? ' copied' : ''}`}
              onClick={() => copy(log.id, formatEntry(log))}
              title="Copy to clipboard"
            >
              {copiedId === log.id ? <Icons.check size={ICON_SIZE.SM} /> : <Icons.copy size={ICON_SIZE.SM} />}
            </button>
          </li>
        ))}
        {jeErrors.map(item => (
          <li key={`je-err-${item.record_id}`} className="processing-status-row processing-status-row--error processing-status-row--je">
            <span className="je-status-dot je-status-dot--error" />
            <div className="processing-status-error-info">
              <span className="processing-status-path" title={item.relative_path}>
                {item.description || item.relative_path}
              </span>
              <span className="processing-status-error-msg">Classification failed</span>
            </div>
            <span className="processing-status-time">{formatTime(item.updated_at)}</span>
          </li>
        ))}
      </ul>
    </>
  );
};
