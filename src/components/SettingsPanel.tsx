import { t } from '../lib/i18n';
import React, { useState, useCallback } from 'react';
import { Icons, ICON_SIZE } from '../shared/icons';
import { useOverlayStore, useLocaleStore } from '../stores';
import { useAppConfig, useCliStatus } from '../lib/queries';

interface Props {
  onVaultChanged?: () => void;
}

const settingsBtnClass = 'bg-bg-secondary border border-border rounded-md px-2.5 py-1 inline-flex items-center gap-1 text-3 font-medium text-text cursor-pointer transition-colors hover:bg-bg-hover';
const dangerBtnClass = `${settingsBtnClass} text-confidence-low hover:bg-confidence-low/10`;
const confirmBtnClass = 'bg-confidence-medium border border-confidence-medium rounded-md px-2.5 py-1 inline-flex items-center gap-1 text-3 font-medium text-white cursor-pointer hover:opacity-85';

export const SettingsPanel: React.FC<Props> = ({ onVaultChanged }) => {
  const goBack = useOverlayStore(s => s.goBack);
  const { data: config = null } = useAppConfig();
  const { data: cliStatus = null } = useCliStatus();
  const locale = useLocaleStore(s => s.locale);
  const changeLocale = useLocaleStore(s => s.changeLocale);
  const [confirmReprocess, setConfirmReprocess] = useState(false);
  const [reprocessResult, setReprocessResult] = useState<string | null>(null);
  const [switchConfirm, setSwitchConfirm] = useState<string | null>(null);
  const [switchNotification, setSwitchNotification] = useState<string | null>(null);
  const [clearConfirmVault, setClearConfirmVault] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<'idle' | 'success' | 'error'>('idle');

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
      if (clearConfirmVault !== vaultPath) {
        setClearConfirmVault(vaultPath);
        return;
      }
      setClearConfirmVault(null);
      await window.api.clearVaultData(vaultPath);
    } else {
      await window.api.removeVault(vaultPath);
    }
    useAppConfig.invalidate();
    onVaultChanged?.();
  }, [clearConfirmVault, onVaultChanged]);

  const handleOpenVault = useCallback((_vaultPath: string) => {
    window.api.locateFolder('');
  }, []);

  const handleReprocessAll = useCallback(async () => {
    if (!confirmReprocess) {
      setConfirmReprocess(true);
      return;
    }
    const result = await window.api.reprocessAll();
    setReprocessResult(`${result.count} ${t('files_reset_to_pending', 'files reset to pending')}.`);
    setConfirmReprocess(false);
  }, [confirmReprocess]);

  const handleQuit = useCallback(async () => {
    await window.api.quitApp();
  }, []);

  const handleExportInstructions = useCallback(async () => {
    const result = await window.api.exportInstructions();
    if (result.canceled) return;
    setExportStatus(result.success ? 'success' : 'error');
    setTimeout(() => setExportStatus('idle'), 3000);
  }, []);

  if (!config) {
    return (
      <div className="flex flex-col flex-1 overflow-y-auto">
        <div className="px-8 py-8 text-center text-text-muted">{`${t('loading', 'Loading')}...`}</div>
      </div>
    );
  }

  const otherVaults = (config.vaultPaths || []).filter(p => p !== config.lastVaultPath);

  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border sticky top-0 bg-bg z-[1]">
        <button
          className="bg-transparent border-none text-text-secondary cursor-pointer px-1.5 py-[2px] rounded inline-flex items-center hover:text-text hover:bg-bg-hover"
          onClick={goBack}
          aria-label="Back"
        >
          <Icons.arrowLeft size={ICON_SIZE.MD} />
        </button>
        <span className="text-3.5 font-semibold">{t('settings', 'Settings')}</span>
      </div>

      {switchNotification && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-md text-3 bg-confidence-high/15 text-confidence-high border border-confidence-high/30 animate-settings-notification-fade">{`${t('switched_to', 'Switched to')} `}<strong className="font-semibold break-all">{switchNotification}</strong>
        </div>
      )}

      {config.lastVaultPath && (
        <div className="px-4 py-2.5">
          <div className="text-2.75 font-semibold text-text-secondary uppercase tracking-[0.5px] mb-1.5">{t('current_vault', 'Current Vault')}</div>
          <div className="flex items-center justify-between gap-2 py-1.5">
            <span className="text-3 text-confidence-high overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1" title={config.lastVaultPath}>
              {config.lastVaultPath}
            </span>
            <div className="flex gap-1.5 shrink-0">
              <button className={settingsBtnClass} onClick={() => handleOpenVault(config.lastVaultPath!)} title="Locate in file manager">{t('locate', 'Locate')}</button>
              <button
                className={clearConfirmVault === config.lastVaultPath ? confirmBtnClass : dangerBtnClass}
                onClick={(e) => handleDisconnectVault(config.lastVaultPath!, e)}
                title={clearConfirmVault === config.lastVaultPath ? 'Click again to confirm clear data' : 'Disconnect (Cmd+click to clear data)'}
              >
                {clearConfirmVault === config.lastVaultPath ? `${t('confirm_clear', 'Confirm Clear')}?` : <Icons.close size={ICON_SIZE.SM} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {otherVaults.length > 0 && (
        <div className="px-4 py-2.5">
          <div className="text-2.75 font-semibold text-text-secondary uppercase tracking-[0.5px] mb-1.5">{t('other_vaults', 'Other Vaults')}</div>
          {otherVaults.map(vp => (
            <div key={vp} className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-3 text-text overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1" title={vp}>{vp}</span>
              <div className="flex gap-1.5 shrink-0">
                <button
                  className={switchConfirm === vp ? confirmBtnClass : settingsBtnClass}
                  onClick={() => handleSwitchVault(vp)}
                  title={switchConfirm === vp ? 'Click again to confirm switch' : 'Switch to this vault'}
                >
                  {switchConfirm === vp ? `${t('confirm', 'Confirm')}?` : <Icons.arrowLeftRight size={ICON_SIZE.SM} />}
                </button>
                <button
                  className={clearConfirmVault === vp ? confirmBtnClass : dangerBtnClass}
                  onClick={(e) => handleDisconnectVault(vp, e)}
                  title={clearConfirmVault === vp ? 'Click again to confirm clear data' : 'Disconnect (Cmd+click to clear data)'}
                >
                  {clearConfirmVault === vp ? `${t('confirm_clear', 'Confirm Clear')}?` : <Icons.close size={ICON_SIZE.SM} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="px-4 py-2.5">
        <button className={settingsBtnClass} onClick={handleAddVault}>{`+ ${t('add_vault', 'Add Vault')}`}</button>
      </div>

      <div className="h-[1px] bg-border mx-4 my-1" />

      <div className="px-4 py-2.5">
        <button
          className={confirmReprocess ? confirmBtnClass : settingsBtnClass}
          onClick={handleReprocessAll}
        >
          {confirmReprocess ? `${t('confirm_reprocess', 'Confirm Reprocess')}?` : t('reprocess_all_files', 'Reprocess All Files')}
        </button>
        {reprocessResult && <div className="text-3 text-text-secondary mt-1.5">{reprocessResult}</div>}
      </div>

      <div className="px-4 py-2.5">
        <div className="text-2.75 font-semibold text-text-secondary uppercase tracking-[0.5px] mb-1.5">{t('ai_instructions', 'AI Instructions')}</div>
        <div className="flex flex-wrap gap-1.5">
          <button className={settingsBtnClass} onClick={() => window.api.openInstructionFile('extraction-prompt')}>
            {t('open_extraction_prompt', 'Open Extraction Prompt')}
          </button>
          <button className={settingsBtnClass} onClick={() => window.api.openInstructionFile('je-instructions')}>
            {t('open_je_instructions', 'Open JE Instructions')}
          </button>
          <button className={settingsBtnClass} onClick={handleExportInstructions}>
            {t('export_instructions', 'Export Instructions')}
          </button>
        </div>
        {exportStatus === 'success' && (
          <div className="text-3 text-confidence-high mt-1.5">{t('export_instructions_success', 'Instructions exported')}</div>
        )}
        {exportStatus === 'error' && (
          <div className="text-3 text-confidence-low mt-1.5">{t('export_instructions_error', 'Export failed')}</div>
        )}
      </div>

      <div className="h-[1px] bg-border mx-4 my-1" />

      <div className="px-4 py-2.5">
        <div className="text-2.75 font-semibold text-text-secondary uppercase tracking-[0.5px] mb-1.5">{t('claude_cli', 'Claude CLI')}</div>
        <div className="text-3 text-text-secondary">
          {cliStatus === null
            ? `${t('checking', 'Checking')}...`
            : cliStatus.available
              ? `${t('found', 'Found')} (${cliStatus.version || t('unknown_version', 'unknown version')})`
              : `${t('not_found_install_claude_code_cli_and_ensure_its_in_your_path', 'Not found — install Claude Code CLI and ensure it\'s in your PATH')}.`}
        </div>
      </div>

      <div className="h-[1px] bg-border mx-4 my-1" />

      <div className="px-4 py-2.5">
        <div className="text-2.75 font-semibold text-text-secondary uppercase tracking-[0.5px] mb-1.5">{t('language', 'Language')}</div>
        <div className="flex gap-1.5">
          <button
            className={locale === 'en' ? confirmBtnClass : settingsBtnClass}
            onClick={() => changeLocale('en')}
          >{t('locale_en', 'EN')}</button>
          <button
            className={locale === 'vi' ? confirmBtnClass : settingsBtnClass}
            onClick={() => changeLocale('vi')}
          >{t('locale_vi', 'VI')}</button>
        </div>
      </div>

      <div className="h-[1px] bg-border mx-4 my-1" />

      <div className="px-4 py-2.5">
        <button className={dangerBtnClass} onClick={handleQuit}>{t('quit_invoicevault', 'Quit InvoiceVault')}</button>
      </div>
    </div>
  );
};
