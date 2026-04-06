import { create } from 'zustand';
import { FileStatus, JEClassificationStatus } from '../shared/types';
import { useHomeData, useFolderStatuses, useQueueData, useProcessedData, useErrorData, useResultDetail } from '../lib/queries';

type StatusIndicator = 'idle' | 'processing' | 'review' | 'error';

interface ProcessingStore {
  /** Overall app processing indicator (shown in SearchInput status dot) */
  status: StatusIndicator;
  /** Bumped on each onFileStatusChanged IPC event; consumers watch this to trigger refreshes */
  fileStatusVersion: number;
  /** Bumped on each onJeStatusChanged IPC event */
  jeStatusVersion: number;
  /** Last JE status change data — consumed by ResultDetail to update per-record JE state */
  lastJeUpdate: { recordIds: string[]; status: JEClassificationStatus } | null;

  /** Subscribe to all 3 IPC events. Call once from App.tsx. Returns cleanup function. */
  startSubscriptions: () => () => void;
}

export const useProcessingStore = create<ProcessingStore>((set) => ({
  status: 'idle',
  fileStatusVersion: 0,
  jeStatusVersion: 0,
  lastJeUpdate: null,

  startSubscriptions: () => {
    const unsubStatus = window.api.onStatusUpdate((status) => {
      set({ status });
    });

    const unsubFile = window.api.onFileStatusChanged(async (_data: { fileIds: string[]; status: FileStatus }) => {
      set((s) => ({ fileStatusVersion: s.fileStatusVersion + 1 }));
      // Invalidate React Query caches
      useHomeData.invalidate();
      useFolderStatuses.invalidate();
      useQueueData.invalidate();
      useProcessedData.invalidate();
      useErrorData.invalidate();
      // Cross-store: update search results' file_status
      const { useSearchStore } = await import('./searchStore');
      const results = useSearchStore.getState().results;
      if (results.length > 0) {
        const paths = [...new Set(results.map(r => r.relative_path))];
        const updatedStatuses = await window.api.getFileStatusesByPaths(paths);
        useSearchStore.getState().updateFileStatuses(updatedStatuses);
      }
    });

    const unsubJe = window.api.onJeStatusChanged((data: { recordIds: string[]; status: JEClassificationStatus }) => {
      set((s) => ({
        jeStatusVersion: s.jeStatusVersion + 1,
        lastJeUpdate: data,
      }));
      // Invalidate React Query caches
      useQueueData.invalidate();
      useErrorData.invalidate();
      for (const id of data.recordIds) {
        useResultDetail.invalidate({ id });
      }
    });

    return () => {
      unsubStatus();
      unsubFile();
      unsubJe();
    };
  },
}));
