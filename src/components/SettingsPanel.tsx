import React, { useState, useEffect, useCallback } from 'react';
import { AppConfig } from '../shared/types';
import { Icons, ICON_SIZE } from '../shared/icons';

interface Props {
  onBack: () => void;
  onVaultChanged?: () => void;
}

export const SettingsPanel: React.FC<Props> = ({ onBack, onVaultChanged }) => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [cliStatus, setCliStatus] = useState<{ available: boolean; version?: string } | null>(null);
  const [confirmReprocess, setConfirmReprocess] = useState(false);
  const [reprocessResult, setReprocessResult] = useState<string | null>(null);
  const [switchConfirm, setSwitchConfirm] = useState<string | null>(null);
  const [switchNotification, setSwitchNotification] = useState<string | null>(null);
  const [clearConfirmVault, setClearConfirmVault] = useState<string | null>(null);

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
      onVaultChanged?.();
    }
  }, [refreshConfig, onVaultChanged]);

  const handleSwitchVault = useCallback(async (vaultPath: string) => {
    if (switchConfirm !== vaultPath) {
      setSwitchConfirm(vaultPath);
      return;
    }
    setSwitchConfirm(null);
    const result = await window.api.switchVault(vaultPath);
    if (result.success) {
      await refreshConfig();
      onVaultChanged?.();
      setSwitchNotification(vaultPath);
      setTimeout(() => setSwitchNotification(null), 4000);
    }
  }, [switchConfirm, refreshConfig, onVaultChanged]);

  const handleDisconnectVault = useCallback(async (vaultPath: string, e: React.MouseEvent) => {
    const isClear = e.metaKey || e.ctrlKey;
    if (isClear) {
      // Ctrl/Cmd+click: clear vault data (with one confirmation)
      if (clearConfirmVault !== vaultPath) {
        setClearConfirmVault(vaultPath);
        return;
      }
      setClearConfirmVault(null);
      await window.api.clearVaultData(vaultPath);
    } else {
      // Normal click: just disconnect
      await window.api.removeVault(vaultPath);
    }
    await refreshConfig();
    onVaultChanged?.();
  }, [clearConfirmVault, refreshConfig, onVaultChanged]);

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
          <Icons.arrowLeft size={ICON_SIZE.MD} />
        </button>
        <span className="settings-title">Settings</span>
      </div>

      {switchNotification && (
        <div className="settings-notification settings-notification-success">
          Switched to <strong>{switchNotification}</strong>
        </div>
      )}

      {config.lastVaultPath && (
        <div className="settings-section">
          <div className="settings-section-label">Current Vault</div>
          <div className="settings-vault-row">
            <span className="settings-vault-path settings-vault-path-active" title={config.lastVaultPath}>
              {config.lastVaultPath}
            </span>
            <div className="settings-vault-actions">
              <button className="settings-icon-btn" onClick={() => handleOpenVault(config.lastVaultPath!)} title="Open in file manager">
                Open
              </button>
              <button
                className={`settings-icon-btn settings-danger`}
                onClick={(e) => handleDisconnectVault(config.lastVaultPath!, e)}
                title={clearConfirmVault === config.lastVaultPath ? 'Click again to confirm clear data' : 'Disconnect (Cmd+click to clear data)'}
              >
                {clearConfirmVault === config.lastVaultPath ? 'Confirm Clear?' : <Icons.close size={ICON_SIZE.SM} />}
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
                <button
                  className={`settings-icon-btn ${switchConfirm === vp ? 'settings-confirm' : ''}`}
                  onClick={() => handleSwitchVault(vp)}
                  title={switchConfirm === vp ? 'Click again to confirm switch' : 'Switch to this vault'}
                >
                  {switchConfirm === vp ? 'Confirm?' : <Icons.arrowLeftRight size={ICON_SIZE.SM} />}
                </button>
                <button
                  className={`settings-icon-btn settings-danger`}
                  onClick={(e) => handleDisconnectVault(vp, e)}
                  title={clearConfirmVault === vp ? 'Click again to confirm clear data' : 'Disconnect (Cmd+click to clear data)'}
                >
                  {clearConfirmVault === vp ? 'Confirm Clear?' : <Icons.close size={ICON_SIZE.SM} />}
                </button>
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
