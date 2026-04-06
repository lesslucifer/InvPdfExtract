import { create } from 'zustand';
import { OverlayState } from '../shared/types';

interface OverlayStore {
  overlayState: OverlayState;
  previousState: OverlayState;
  isWindowlized: boolean;

  /** Navigate to a new overlay state, saving current as previousState */
  goTo: (state: OverlayState) => void;
  /** Return to previousState (guards against returning to the same panel) */
  goBack: () => void;
  /** Direct setter for cases where goTo's previousState tracking isn't wanted */
  setOverlayState: (state: OverlayState) => void;
  /** Initialize windowlized flag from URL params */
  initWindowlized: () => void;
}

export const useOverlayStore = create<OverlayStore>((set, get) => ({
  overlayState: OverlayState.Home,
  previousState: OverlayState.Home,
  isWindowlized: false,

  goTo: (state) => {
    set({ previousState: get().overlayState, overlayState: state });
  },

  goBack: () => {
    const { previousState, overlayState } = get();
    // If previousState is same as current (e.g. opened Settings from Settings), go Home
    const target = previousState === overlayState ? OverlayState.Home : previousState;
    set({ overlayState: target });
  },

  setOverlayState: (state) => {
    set({ overlayState: state });
  },

  initWindowlized: () => {
    const params = new URLSearchParams(window.location.search);
    set({ isWindowlized: params.get('windowlized') === 'true' });
  },
}));
