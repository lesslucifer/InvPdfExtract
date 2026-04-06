import { mutationHook } from './mutationHook';
import { usePresets } from './queries';

export const useDeletePreset = mutationHook
  .mutate<string>(id => window.api.deletePreset(id))
  .onSuccess(() => usePresets.invalidate());
