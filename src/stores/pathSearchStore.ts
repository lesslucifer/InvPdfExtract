import { create } from 'zustand';
import { OverlayState } from '../shared/types';

interface PathSearchStore {
  pathQuery: string;
  prePathState: OverlayState;

  setPathQuery: (query: string) => void;
  setPrePathState: (state: OverlayState) => void;
  reset: () => void;
}

export const usePathSearchStore = create<PathSearchStore>((set) => ({
  pathQuery: '',
  prePathState: OverlayState.Home,

  setPathQuery: (query) => set({ pathQuery: query }),
  setPrePathState: (state) => set({ prePathState: state }),
  reset: () => set({ pathQuery: '', prePathState: OverlayState.Home }),
}));
