import React, { useState, useEffect } from 'react';
import { VaultFile, FileStatus, ProcessedFileInfo, ErrorLogEntry } from '../shared/types';
import { StatusDot } from './StatusDot';

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
  const [processedFiles, setProcessedFiles] = useState<ProcessedFileInfo[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        if (activeTab === 'queue') {
          const files = await window.api.getFilesByStatuses([FileStatus.Pending, FileStatus.Processing]);
          if (!cancelled) setQueueFiles(files);
        } else if (activeTab === 'processed') {
          const files = await window.api.getProcessedFilesWithStats();
          if (!cancelled) setProcessedFiles(files);
        } else {
          const logs = await window.api.getErrorLogsWithPath();
          if (!cancelled) setErrorLogs(logs);
        }
      } catch (err) {
        console.error('[ProcessingStatusPanel] Load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeTab]);

  // Subscribe to real-time updates to refresh the active tab
  useEffect(() => {
    const unsubscribe = window.api.onFileStatusChanged(async () => {
      try {
        if (activeTab === 'queue') {
          const files = await window.api.getFilesByStatuses([FileStatus.Pending, FileStatus.Processing]);
          setQueueFiles(files);
        } else if (activeTab === 'processed') {
          const files = await window.api.getProcessedFilesWithStats();
          setProcessedFiles(files);
        } else {
          const logs = await window.api.getErrorLogsWithPath();
          setErrorLogs(logs);
        }
      } catch { /* ignore */ }
    });
    return unsubscribe;
  }, [activeTab]);

  const reloadQueue = async () => {
    try {
      const files = await window.api.getFilesByStatuses([FileStatus.Pending, FileStatus.Processing]);
      setQueueFiles(files);
    } catch { /* ignore */ }
  };

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'queue', label: 'Queue', count: queueFiles.length },
    { id: 'processed', label: 'Processed', count: processedFiles.length },
    { id: 'errors', label: 'Errors', count: errorLogs.length },
  ];

  return (
    <div className="processing-status-panel">
      <div className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Back">
          &#x2190;
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
          <QueueTab files={queueFiles} onRefresh={reloadQueue} />
        ) : activeTab === 'processed' ? (
          <ProcessedTab files={processedFiles} />
        ) : (
          <ErrorsTab logs={errorLogs} />
        )}
      </div>
    </div>
  );
};

const QueueTab: React.FC<{ files: VaultFile[]; onRefresh: () => Promise<void> }> = ({ files, onRefresh }) => {
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

  if (files.length === 0) {
    return <div className="processing-status-empty">No files in queue</div>;
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
              {copiedId === file.id ? '\u2713' : '\u29C9'}
            </button>
            {file.status === FileStatus.Pending && (
              <button
                className="processing-queue-cancel-btn"
                onClick={() => handleCancel(file.id)}
                title="Remove from queue"
              >
                &#x2715;
              </button>
            )}
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
              {copiedId === file.id ? '\u2713' : '\u29C9'}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
};

const ErrorsTab: React.FC<{ logs: ErrorLogEntry[] }> = ({ logs }) => {
  const { copiedId, copy } = useCopyFeedback();

  const formatEntry = (log: ErrorLogEntry) =>
    `File: ${log.relative_path || 'Unknown file'}\nError: ${log.message}`;

  const handleCopyAll = () => {
    const text = logs.map(formatEntry).join('\n\n');
    copy('__all__', text);
  };

  if (logs.length === 0) {
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
              {copiedId === log.id ? '\u2713' : '\u29C9'}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
};
