import { create } from 'zustand';
import { FileStatus, JEClassificationStatus } from '../shared/types';

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

    const unsubFile = window.api.onFileStatusChanged((_data: { fileIds: string[]; status: FileStatus }) => {
      set((s) => ({ fileStatusVersion: s.fileStatusVersion + 1 }));
    });

    const unsubJe = window.api.onJeStatusChanged((data: { recordIds: string[]; status: JEClassificationStatus }) => {
      set((s) => ({
        jeStatusVersion: s.jeStatusVersion + 1,
        lastJeUpdate: data,
      }));
    });

    return () => {
      unsubStatus();
      unsubFile();
      unsubJe();
    };
  },
}));
