import React, { useState, useCallback } from 'react';
import { OverlayState } from '../shared/types';
import { useOverlayStore } from '../stores';

export const NoVaultScreen: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChooseFolder = useCallback(async () => {
    setError(null);
    const folderPath = await window.api.pickFolder();
    if (!folderPath) return; // User cancelled

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
    <div className="no-vault-screen">
      <div className="no-vault-content">
        <div className="no-vault-title">InvoiceVault</div>
        <p className="no-vault-description">
          Select a folder to get started.<br />
          It will be initialized as a vault and watched for invoices &amp; bank statements.
        </p>
        <button
          className="no-vault-button"
          onClick={handleChooseFolder}
          disabled={loading}
        >
          {loading ? 'Initializing...' : 'Choose Folder...'}
        </button>
        {error && <div className="no-vault-error">{error}</div>}
      </div>
    </div>
  );
};
