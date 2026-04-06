import { useEffect } from 'react';
import { useProcessingStore } from './processingStore';

/**
 * Initializes all centralized IPC subscriptions.
 * Call once from the root App component.
 */
export function useInitSubscriptions() {
  useEffect(() => {
    return useProcessingStore.getState().startSubscriptions();
  }, []);
}
