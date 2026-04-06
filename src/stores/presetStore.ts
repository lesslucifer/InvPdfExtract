import { create } from 'zustand';
import { OverlayState } from '../shared/types';

interface PresetStore {
  presetQuery: string;
  prePresetState: OverlayState;
  showSaveModal: boolean;

  setPresetQuery: (query: string) => void;
  setPrePresetState: (state: OverlayState) => void;
  setShowSaveModal: (show: boolean) => void;
  reset: () => void;
}

export const usePresetStore = create<PresetStore>((set) => ({
  presetQuery: '',
  prePresetState: OverlayState.Home,
  showSaveModal: false,

  setPresetQuery: (query) => set({ presetQuery: query }),
  setPrePresetState: (state) => set({ prePresetState: state }),
  setShowSaveModal: (show) => set({ showSaveModal: show }),
  reset: () => set({ presetQuery: '', prePresetState: OverlayState.Home }),
}));
