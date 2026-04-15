import { t } from '../lib/i18n';
import React, { useCallback, useState } from 'react';
import { OverlayState } from '../shared/types';
import { useOverlayStore, useProcessingStore } from '../stores';

export const DbErrorScreen: React.FC = () => {
  const error = useProcessingStore(s => s.dbError);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleOpenSettings = useCallback(() => {
    useOverlayStore.getState().goTo(OverlayState.Settings);
  }, []);

  const handleRetry = useCallback(async () => {
    const config = await window.api.getAppConfig();
    if (config.lastVaultPath) {
      const result = await window.api.switchVault(config.lastVaultPath);
      if (result.success) {
        useProcessingStore.setState({ dbError: null });
        useOverlayStore.getState().setOverlayState(OverlayState.Home);
      }
    }
  }, []);

  const handleReinitialize = useCallback(async () => {
    if (!confirmed) {
      setConfirmed(true);
      return;
    }
    setLoading(true);
    const config = await window.api.getAppConfig();
    if (config.lastVaultPath) {
      const result = await window.api.reinitializeVault(config.lastVaultPath);
      if (result.success) {
        useProcessingStore.setState({ dbError: null });
        useOverlayStore.getState().setOverlayState(OverlayState.Home);
      } else {
        useProcessingStore.setState({ dbError: result.error ?? 'Reinitialize failed' });
      }
    }
    setLoading(false);
  }, [confirmed]);

  return (
    <div className="flex items-center justify-center px-6 py-12">
      <div className="text-center max-w-[400px]">
        <div className="w-10 h-10 rounded-full bg-confidence-low/10 flex items-center justify-center mx-auto mb-4">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="text-confidence-low">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="text-4 font-semibold mb-2">{t('database_error', 'Database Error')}</div>
        <p className="text-3.25 text-text-secondary leading-[1.5] mb-2">{`${t('invoicevault_failed_to_open_its_database', 'InvoiceVault failed to open its database')}.`}</p>
        {error && (
          <p className="text-3 text-confidence-low font-mono bg-bg-secondary rounded-lg px-3 py-2 mb-5 text-left break-all">
            {error}
          </p>
        )}
        {confirmed && (
          <p className="text-3 text-confidence-low bg-confidence-low/10 rounded-lg px-3 py-2 mb-4">
            {t('reinitialize_warning', 'This will erase all extraction data and start fresh. A backup will be attempted first.')}
          </p>
        )}
        <div className="flex gap-2 justify-center">
          <button
            className="bg-accent text-white border-none rounded-lg px-5 py-2 text-3.25 font-semibold cursor-pointer transition-opacity hover:opacity-85"
            onClick={handleRetry}
          >{t('retry', 'Retry')}</button>
          <button
            className="bg-confidence-low/10 text-confidence-low border border-confidence-low/30 rounded-lg px-5 py-2 text-3.25 font-semibold cursor-pointer transition-opacity hover:opacity-85 disabled:opacity-50"
            onClick={handleReinitialize}
            disabled={loading}
          >{loading
              ? t('reinitializing', 'Reinitializing...')
              : confirmed
                ? t('confirm_reinitialize', 'Confirm Reinitialize')
                : t('reinitialize', 'Reinitialize')
          }</button>
          <button
            className="bg-bg-secondary text-text border border-border rounded-lg px-5 py-2 text-3.25 font-semibold cursor-pointer transition-colors hover:bg-bg-hover"
            onClick={handleOpenSettings}
          >{t('switch_vault', 'Switch Vault')}</button>
        </div>
      </div>
    </div>
  );
};
