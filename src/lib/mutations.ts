import { mutationHook } from './mutationHook';
import { usePresets, useQueueData } from './queries';

export const useDeletePreset = mutationHook
  .mutate<string>(id => window.api.deletePreset(id))
  .onSuccess(() => usePresets.invalidate());

export const useCancelQueueItem = mutationHook
  .mutate<string, { success: boolean }>(id => window.api.cancelQueueItem(id))
  .onSuccess(() => useQueueData.invalidate());

export const useClearPendingQueue = mutationHook
  .mutate<void, { count: number }>(() => window.api.clearPendingQueue())
  .onSuccess(() => useQueueData.invalidate());
