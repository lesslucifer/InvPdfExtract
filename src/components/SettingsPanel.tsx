import React, { useState, useEffect, useCallback } from 'react';
import { AppConfig } from '../shared/types';

interface Props {
  onBack: () => void;
}

export const SettingsPanel: React.FC<Props> = ({ onBack }) => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [cliStatus, setCliStatus] = useState<{ available: boolean; version?: string } | null>(null);
  const [confirmReprocess, setConfirmReprocess] = useState(false);
  const [reprocessResult, setReprocessResult] = useState<string | null>(null);

  useEffect(() => {
    window.api.getAppConfig().then(setConfig);
    window.api.checkClaudeCli().then(setCliStatus);
  }, []);

  const refreshConfig = useCallback(async () => {
    const c = await window.api.getAppConfig();
    setConfig(c);
  }, []);

  const handleAddVault = useCallback(async () => {
    const folderPath = await window.api.pickFolder();
    if (!folderPath) return;
    const result = await window.api.initVault(folderPath);
    if (result.success) {
      await refreshConfig();
    }
  }, [refreshConfig]);

  const handleSwitchVault = useCallback(async (vaultPath: string) => {
    const result = await window.api.switchVault(vaultPath);
    if (result.success) {
      await refreshConfig();
    }
  }, [refreshConfig]);

  const handleRemoveVault = useCallback(async (vaultPath: string) => {
    await window.api.removeVault(vaultPath);
    await refreshConfig();
  }, [refreshConfig]);

  const handleOpenVault = useCallback((vaultPath: string) => {
    // Open the vault root (pass empty string since open-folder joins with vaultPath)
    // For non-active vaults we need the full path, but the IPC handler uses vaultPath
    // So for the active vault, pass '' to open the root
    window.api.openFolder('');
  }, []);

  const handleReprocessAll = useCallback(async () => {
    if (!confirmReprocess) {
      setConfirmReprocess(true);
      return;
    }
    const result = await window.api.reprocessAll();
    setReprocessResult(`Reset ${result.count} files to pending.`);
    setConfirmReprocess(false);
  }, [confirmReprocess]);

  const handleQuit = useCallback(async () => {
    await window.api.quitApp();
  }, []);

  if (!config) {
    return <div className="settings-panel"><div className="settings-loading">Loading...</div></div>;
  }

  const otherVaults = (config.vaultPaths || []).filter(p => p !== config.lastVaultPath);

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <button className="settings-back-btn" onClick={onBack} aria-label="Back">
          &larr;
        </button>
        <span className="settings-title">Settings</span>
      </div>

      {config.lastVaultPath && (
        <div className="settings-section">
          <div className="settings-section-label">Current Vault</div>
          <div className="settings-vault-row">
            <span className="settings-vault-path" title={config.lastVaultPath}>
              {config.lastVaultPath}
            </span>
            <div className="settings-vault-actions">
              <button className="settings-icon-btn" onClick={() => handleOpenVault(config.lastVaultPath!)} title="Open in file manager">
                Open
              </button>
              <button className="settings-icon-btn settings-danger" onClick={() => handleRemoveVault(config.lastVaultPath!)} title="Disconnect vault">
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {otherVaults.length > 0 && (
        <div className="settings-section">
          <div className="settings-section-label">Other Vaults</div>
          {otherVaults.map(vp => (
            <div key={vp} className="settings-vault-row">
              <span className="settings-vault-path" title={vp}>{vp}</span>
              <div className="settings-vault-actions">
                <button className="settings-action-btn" onClick={() => handleSwitchVault(vp)}>Switch</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="settings-section">
        <button className="settings-action-btn" onClick={handleAddVault}>+ Add Vault</button>
      </div>

      <div className="settings-divider" />

      <div className="settings-section">
        <button
          className={`settings-action-btn ${confirmReprocess ? 'settings-confirm' : ''}`}
          onClick={handleReprocessAll}
        >
          {confirmReprocess ? 'Confirm Reprocess?' : 'Reprocess All Files'}
        </button>
        {reprocessResult && <div className="settings-result">{reprocessResult}</div>}
      </div>

      <div className="settings-section">
        <div className="settings-section-label">Claude CLI</div>
        <div className="settings-cli-status">
          {cliStatus === null
            ? 'Checking...'
            : cliStatus.available
              ? `Found (${cliStatus.version || 'unknown version'})`
              : 'Not found — install Claude Code CLI and ensure it\'s in your PATH.'}
        </div>
      </div>

      <div className="settings-divider" />

      <div className="settings-section">
        <button className="settings-action-btn settings-danger" onClick={handleQuit}>
          Quit InvoiceVault
        </button>
      </div>
    </div>
  );
};
