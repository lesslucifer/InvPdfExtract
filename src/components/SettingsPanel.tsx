import React, { useState, useCallback } from 'react';
import { Icons, ICON_SIZE } from '../shared/icons';
import { useOverlayStore } from '../stores';
import { useAppConfig, useCliStatus } from '../lib/queries';

interface Props {
  onVaultChanged?: () => void;
}

export const SettingsPanel: React.FC<Props> = ({ onVaultChanged }) => {
  const goBack = useOverlayStore(s => s.goBack);
  const { data: config = null } = useAppConfig();
  const { data: cliStatus = null } = useCliStatus();
  const [confirmReprocess, setConfirmReprocess] = useState(false);
  const [reprocessResult, setReprocessResult] = useState<string | null>(null);
  const [switchConfirm, setSwitchConfirm] = useState<string | null>(null);
  const [switchNotification, setSwitchNotification] = useState<string | null>(null);
  const [clearConfirmVault, setClearConfirmVault] = useState<string | null>(null);

  const handleAddVault = useCallback(async () => {
    const folderPath = await window.api.pickFolder();
    if (!folderPath) return;
    const result = await window.api.initVault(folderPath);
    if (result.success) {
      useAppConfig.invalidate();
      onVaultChanged?.();
    }
  }, [onVaultChanged]);

  const handleSwitchVault = useCallback(async (vaultPath: string) => {
    if (switchConfirm !== vaultPath) {
      setSwitchConfirm(vaultPath);
      return;
    }
    setSwitchConfirm(null);
    const result = await window.api.switchVault(vaultPath);
    if (result.success) {
      useAppConfig.invalidate();
      onVaultChanged?.();
      setSwitchNotification(vaultPath);
      setTimeout(() => setSwitchNotification(null), 4000);
    }
  }, [switchConfirm, onVaultChanged]);

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
    useAppConfig.invalidate();
    onVaultChanged?.();
  }, [clearConfirmVault, onVaultChanged]);

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
        <button className="settings-back-btn" onClick={goBack} aria-label="Back">
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
