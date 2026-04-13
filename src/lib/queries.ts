import { AppConfig, VaultConfig, FilterPreset, SearchFilters, FileStatus, VaultFile, FieldOverrideInfo, InvoiceLineItem, ProcessedFileInfo, DuplicateSourceRow } from '../shared/types';
import { queryHook } from './queryHook';

const ALL_FILTERS: SearchFilters = {};

export const useAppConfig = queryHook
  .ofKey<void, ['appConfig']>(() => ['appConfig'] as const)
  .useQuery(() => ({ queryFn: () => window.api.getAppConfig() as Promise<AppConfig> }))
  .create();

export const useVaultConfig = queryHook
  .ofKey<void, ['vaultConfig']>(() => ['vaultConfig'] as const)
  .useQuery(() => ({ queryFn: () => window.api.getVaultConfig() as Promise<VaultConfig> }))
  .create();

export const useAppVersion = queryHook
  .ofKey<void, ['appVersion']>(() => ['appVersion'] as const)
  .useQuery(() => ({ queryFn: () => window.api.getAppVersion() }))
  .create();

export const useCliStatus = queryHook
  .ofKey<void, ['cliStatus']>(() => ['cliStatus'] as const)
  .useQuery(() => ({ queryFn: () => window.api.checkClaudeCli() as Promise<{ available: boolean; version?: string }> }))
  .create();

export const usePresets = queryHook
  .ofKey<void, ['presets']>(() => ['presets'] as const)
  .useQuery(() => ({ queryFn: () => window.api.listPresets() as Promise<FilterPreset[]> }))
  .create();

export const useHomeData = queryHook
  .ofKey<void, ['homeData']>(() => ['homeData'] as const)
  .useQuery(() => ({
    queryFn: () => Promise.all([
      window.api.listRecentFolders(5),
      window.api.listTopFolders(),
      window.api.getAggregates(ALL_FILTERS),
    ]).then(([recentFolders, topFolders, aggregates]) => ({ recentFolders, topFolders, aggregates }))
  }))
  .create();

export const useFolderStatuses = queryHook
  .ofKey<void, ['folderStatuses']>(() => ['folderStatuses'] as const)
  .useQuery(() => ({ queryFn: () => window.api.getFolderStatuses() as Promise<Record<string, FileStatus>> }))
  .create();

export const useQueueData = queryHook
  .ofKey<void, ['queue']>(() => ['queue'] as const)
  .useQuery(() => ({
    queryFn: () => Promise.all([
      window.api.getFilesByStatuses([FileStatus.Pending, FileStatus.Processing]),
      window.api.getJeQueueItems(),
    ]).then(([files, jeItems]) => ({ files, jeItems }))
  }))
  .create();

export const useProcessedData = queryHook
  .ofKey<void, ['processed']>(() => ['processed'] as const)
  .useQuery(() => ({ queryFn: () => window.api.getProcessedFilesWithStats() as Promise<ProcessedFileInfo[]> }))
  .create();

export const useErrorData = queryHook
  .ofKey<void, ['errors']>(() => ['errors'] as const)
  .useQuery(() => ({
    queryFn: () => Promise.all([
      window.api.getErrorLogsWithPath(),
      window.api.getJeErrorItems(),
    ]).then(([logs, jeErrors]) => ({ logs, jeErrors }))
  }))
  .create();

export const useSkippedData = queryHook
  .ofKey<void, ['skipped']>(() => ['skipped'] as const)
  .useQuery(() => ({
    queryFn: () => window.api.getFilesByStatuses([FileStatus.Skipped]) as Promise<VaultFile[]>
  }))
  .create();

export const useResultDetail = queryHook
  .ofKey<{ id: string }, ['resultDetail', string]>(({ id }) => ['resultDetail', id] as const)
  .useQuery(({ params }) => ({
    queryFn: () => Promise.all([
      window.api.getFieldOverrides(params.id),
      window.api.getJournalEntries(params.id),
    ]).then(([overrides, journalEntries]) => ({ overrides, journalEntries }))
  }))
  .create();

export const useLineItems = queryHook
  .ofKey<{ id: string }, ['lineItems', string]>(({ id }) => ['lineItems', id] as const)
  .useQuery(({ params }) => ({
    queryFn: () => window.api.getLineItems(params.id).then(async (lineItems) => {
      if (lineItems.length === 0) return { lineItems, lineItemOverrides: {} as Record<string, FieldOverrideInfo[]> };
      const ids = lineItems.map((i: InvoiceLineItem) => i.id);
      const lineItemOverrides = await window.api.getLineItemOverrides(ids);
      return { lineItems, lineItemOverrides };
    })
  }))
  .create();

export const useDuplicateSources = queryHook
  .ofKey<{ id: string }, ['duplicateSources', string]>(({ id }) => ['duplicateSources', id] as const)
  .useQuery(({ params }) => ({
    queryFn: () => window.api.getDuplicateSources(params.id) as Promise<DuplicateSourceRow[]>,
  }))
  .create();
