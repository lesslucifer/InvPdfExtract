import { AppConfig, FilterPreset } from '../shared/types';
import { queryHook } from './queryHook';

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
