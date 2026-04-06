import { mutationHook } from './mutationHook';
import { usePresets, useQueueData, useResultDetail, useLineItems } from './queries';
import { FieldOverrideInput, JournalEntryInput, JournalEntry, LineItemFieldInput } from '../shared/types';

export const useDeletePreset = mutationHook
  .mutate<string>(id => window.api.deletePreset(id))
  .onSuccess(() => usePresets.invalidate());

export const useCancelQueueItem = mutationHook
  .mutate<string, { success: boolean }>(id => window.api.cancelQueueItem(id))
  .onSuccess(() => useQueueData.invalidate());

export const useClearPendingQueue = mutationHook
  .mutate<void, { count: number }>(() => window.api.clearPendingQueue())
  .onSuccess(() => useQueueData.invalidate());

export const useSaveFieldOverride = mutationHook
  .mutate<FieldOverrideInput>((input) => window.api.saveFieldOverride(input))
  .onSuccess((_, input) => useResultDetail.invalidate({ id: input.recordId }));

export const useSaveJournalEntry = mutationHook
  .mutate<JournalEntryInput, JournalEntry>((input) => window.api.saveJournalEntry(input))
  .onSuccess((_, input) => useResultDetail.invalidate({ id: input.recordId }));

export const useSaveLineItemField = mutationHook
  .mutate<{ input: LineItemFieldInput; recordId: string }>(({ input }) => window.api.saveLineItemField(input))
  .onSuccess((_, { recordId }) => useLineItems.invalidate({ id: recordId }));
