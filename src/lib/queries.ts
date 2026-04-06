import { AppConfig, FilterPreset, FolderInfo, AggregateStats, SearchFilters, FileStatus, VaultFile, ProcessedFileInfo, ErrorLogEntry, JeQueueItem, JeErrorItem } from '../shared/types';
import { queryHook } from './queryHook';

const ALL_FILTERS: SearchFilters = {};

export const useAppConfig = queryHook
  .ofKey<void, ['appConfig']>(() => ['appConfig'] as const)
  .useQuery(() => ({ queryFn: () => window.api.getAppConfig() as Promise<AppConfig> }))
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
