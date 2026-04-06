import { t } from '../lib/i18n';
import React, { useState, useCallback } from 'react';
import { OverlayState } from '../shared/types';
import { useOverlayStore } from '../stores';

export const NoVaultScreen: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChooseFolder = useCallback(async () => {
    setError(null);
    const folderPath = await window.api.pickFolder();
    if (!folderPath) return;

    setLoading(true);
    try {
      const result = await window.api.initVault(folderPath);
      if (result.success) {
        useOverlayStore.getState().goTo(OverlayState.Home);
      } else {
        setError(result.error || 'Failed to initialize vault.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="flex items-center justify-center px-6 py-12">
      <div className="text-center max-w-[360px]">
        <div className="text-5 font-bold mb-3">{t('invoicevault', 'InvoiceVault')}</div>
        <p className="text-3.25 text-text-secondary leading-[1.5] mb-5">{`${t('select_a_folder_to_get_started', 'Select a folder to get started')}.`}<br />{`${t('it_will_be_initialized_as_a_vault_and_watched_for_invoices_bank_statements', 'It will be initialized as a vault and watched for invoices & bank statements')}.`}</p>
        <button
          className="bg-accent text-white border-none rounded-lg px-6 py-2.5 text-3.5 font-semibold cursor-pointer transition-opacity hover:opacity-85 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleChooseFolder}
          disabled={loading}
        >
          {loading ? `${t('initializing', 'Initializing')}...` : `${t('choose_folder', 'Choose Folder')}...`}
        </button>
        {error && <div className="mt-3 text-confidence-low text-3">{error}</div>}
      </div>
    </div>
  );
};
