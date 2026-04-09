import { create } from 'zustand';
import { FileStatus, JEGenerationStatus, OverlayState } from '../shared/types';
import { useHomeData, useFolderStatuses, useQueueData, useProcessedData, useErrorData, useResultDetail } from '../lib/queries';
import { useSearchStore } from './searchStore';
import { useOverlayStore } from './overlayStore';

interface ProcessingStore {
  /** Bumped on each onJeStatusChanged IPC event */
  jeStatusVersion: number;
  /** Last JE status change data — consumed by ResultDetail to update per-record JE state */
  lastJeUpdate: { recordIds: string[]; status: JEGenerationStatus } | null;
  /** Set when the vault DB fails to open */
  dbError: string | null;

  /** Subscribe to all IPC events. Call once from App.tsx. Returns cleanup function. */
  startSubscriptions: () => () => void;
}

export const useProcessingStore = create<ProcessingStore>((set) => ({
  jeStatusVersion: 0,
  lastJeUpdate: null,
  dbError: null,

  startSubscriptions: () => {
    const unsubFile = window.api.onFileStatusChanged(async (_data: { fileIds: string[]; status: FileStatus }) => {
      // Invalidate React Query caches
      useHomeData.invalidate();
      useFolderStatuses.invalidate();
      useQueueData.invalidate();
      useProcessedData.invalidate();
      useErrorData.invalidate();
      // Cross-store: update search results' file_status
      const results = useSearchStore.getState().results;
      if (results.length > 0) {
        const paths = [...new Set(results.map(r => r.relative_path))];
        const updatedStatuses = await window.api.getFileStatusesByPaths(paths);
        useSearchStore.getState().updateFileStatuses(updatedStatuses);
      }
    });

    const unsubJe = window.api.onJeStatusChanged((data: { recordIds: string[]; status: JEGenerationStatus }) => {
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

    const unsubDbError = window.api.onDbError(async (error: string) => {
      set({ dbError: error });
      useOverlayStore.getState().setOverlayState(OverlayState.DbError);
    });

    const unsubFileDeleted = window.api.onFileDeleted(async ({ relativePath }) => {
      useHomeData.invalidate();
      useFolderStatuses.invalidate();
      useQueueData.invalidate();
      useProcessedData.invalidate();
      useErrorData.invalidate();
      useSearchStore.getState().removeResultsForFile(relativePath);
    });

    return () => {
      unsubFile();
      unsubJe();
      unsubDbError();
      unsubFileDeleted();
    };
  },
}));
