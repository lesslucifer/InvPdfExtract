import { t } from '../lib/i18n';
import React, { useState, useCallback } from 'react';
import { Icons, ICON_SIZE } from '../shared/icons';
import { DEFAULT_AMOUNT_TOLERANCE } from '../shared/constants';
import { useOverlayStore, useLocaleStore } from '../stores';
import { useAppConfig, useAppVersion, useCliStatus, useVaultConfig } from '../lib/queries';

interface Props {
  onVaultChanged?: () => void;
}

const settingsBtnClass = 'bg-bg-secondary border border-border rounded-md px-2.5 py-1 inline-flex items-center gap-1 text-3 font-medium text-text cursor-pointer transition-colors hover:bg-bg-hover';
const dangerBtnClass = `${settingsBtnClass} text-confidence-low hover:bg-confidence-low/10`;
const confirmBtnClass = 'bg-confidence-medium border border-confidence-medium rounded-md px-2.5 py-1 inline-flex items-center gap-1 text-3 font-medium text-white cursor-pointer hover:opacity-85';
const localeBtnActiveClass = 'bg-accent border border-accent rounded-md px-2.5 py-1 inline-flex items-center gap-1 text-3 font-medium text-white cursor-pointer hover:opacity-85';
const localeBtnClass = 'bg-bg-secondary border border-accent/30 rounded-md px-2.5 py-1 inline-flex items-center gap-1 text-3 font-medium text-accent cursor-pointer transition-colors hover:bg-accent/10';

export const SettingsPanel: React.FC<Props> = ({ onVaultChanged }) => {
  const goBack = useOverlayStore(s => s.goBack);
  const { data: config = null } = useAppConfig();
  const { data: vaultConfig = null } = useVaultConfig();
  const { data: appVersion = '' } = useAppVersion();
  const { data: cliStatus = null } = useCliStatus();
  const locale = useLocaleStore(s => s.locale);
  const changeLocale = useLocaleStore(s => s.changeLocale);
  const [switchConfirm, setSwitchConfirm] = useState<string | null>(null);
  const [switchNotification, setSwitchNotification] = useState<string | null>(null);
  const [clearConfirmVault, setClearConfirmVault] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [backupStatus, setBackupStatus] = useState<Record<string, 'idle' | 'busy' | 'success' | 'error'>>({});
  const [toleranceInput, setToleranceInput] = useState<string | null>(null);

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
    const isPendingClearConfirm = clearConfirmVault === vaultPath;

    if (isPendingClearConfirm) {
      // Second click (with or without modifier) confirms the clear
      console.log('[SettingsPanel] Confirmed clear vault:', vaultPath);
      setClearConfirmVault(null);
      await window.api.clearVaultData(vaultPath);
    } else if (isClear) {
      console.log('[SettingsPanel] Clear requested, awaiting confirmation for:', vaultPath);
      setClearConfirmVault(vaultPath);
      return;
    } else {
      console.log('[SettingsPanel] Disconnect (remove) vault:', vaultPath);
      await window.api.removeVault(vaultPath);
    }
    useAppConfig.invalidate();
    onVaultChanged?.();
  }, [clearConfirmVault, onVaultChanged]);

  const handleOpenVault = useCallback((_vaultPath: string) => {
    window.api.locateFolder('');
  }, []);

  const handleQuit = useCallback(async () => {
    await window.api.quitApp();
  }, []);

  const handleBackupVault = useCallback(async (vaultPath: string) => {
    setBackupStatus(s => ({ ...s, [vaultPath]: 'busy' }));
    const result = await window.api.backupVault(vaultPath);
    if (result.canceled) {
      setBackupStatus(s => ({ ...s, [vaultPath]: 'idle' }));
      return;
    }
    setBackupStatus(s => ({ ...s, [vaultPath]: result.success ? 'success' : 'error' }));
    setTimeout(() => setBackupStatus(s => ({ ...s, [vaultPath]: 'idle' })), 3000);
  }, []);

  const handleVaultDataClick = useCallback((vaultPath: string, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      handleBackupVault(vaultPath);
    } else {
      window.api.openVaultDataFolder(vaultPath);
    }
  }, [handleBackupVault]);

  const handleExportInstructions = useCallback(async () => {
    const result = await window.api.exportInstructions();
    if (result.canceled) return;
    setExportStatus(result.success ? 'success' : 'error');
    setTimeout(() => setExportStatus('idle'), 3000);
  }, []);

  const handleToleranceSave = useCallback(async () => {
    if (toleranceInput == null) return;
    const val = parseInt(toleranceInput, 10);
    if (isNaN(val) || val < 0) return;
    await window.api.updateVaultConfig({ amountTolerance: val });
    useVaultConfig.invalidate();
    setToleranceInput(null);
  }, [toleranceInput]);

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
          aria-label={t('back', 'Back')}
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
              <button className={settingsBtnClass} onClick={() => handleOpenVault(config.lastVaultPath!)} title={t('locate_in_file_manager', 'Locate in file manager')}>{t('locate', 'Locate')}</button>
              <button
                className={settingsBtnClass}
                onClick={(e) => handleVaultDataClick(config.lastVaultPath!, e)}
                disabled={backupStatus[config.lastVaultPath!] === 'busy'}
                title={t('open_vault_data_title', 'Open vault data folder (Cmd+click to backup)')}
              >
                {backupStatus[config.lastVaultPath!] === 'busy'
                  ? `${t('backing_up', 'Backing up')}...`
                  : backupStatus[config.lastVaultPath!] === 'success'
                    ? t('backup_done', 'Backed up!')
                    : backupStatus[config.lastVaultPath!] === 'error'
                      ? t('backup_failed', 'Backup failed')
                      : t('vault_data', 'Vault Data')}
              </button>
              <button
                className={clearConfirmVault === config.lastVaultPath ? confirmBtnClass : dangerBtnClass}
                onClick={(e) => handleDisconnectVault(config.lastVaultPath!, e)}
                title={clearConfirmVault === config.lastVaultPath ? t('click_again_to_confirm_clear', 'Click again to confirm clear data') : t('disconnect_cmd_click_to_clear', 'Disconnect (Cmd+click to clear data)')}
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
                  title={switchConfirm === vp ? t('click_again_to_confirm_switch', 'Click again to confirm switch') : t('switch_to_this_vault', 'Switch to this vault')}
                >
                  {switchConfirm === vp ? `${t('confirm', 'Confirm')}?` : <Icons.arrowLeftRight size={ICON_SIZE.SM} />}
                </button>
                <button
                  className={settingsBtnClass}
                  onClick={(e) => handleVaultDataClick(vp, e)}
                  disabled={backupStatus[vp] === 'busy'}
                  title={t('open_vault_data_title', 'Open vault data folder (Cmd+click to backup)')}
                >
                  {backupStatus[vp] === 'busy'
                    ? `${t('backing_up', 'Backing up')}...`
                    : backupStatus[vp] === 'success'
                      ? t('backup_done', 'Backed up!')
                      : backupStatus[vp] === 'error'
                        ? t('backup_failed', 'Backup failed')
                        : t('vault_data', 'Vault Data')}
                </button>
                <button
                  className={clearConfirmVault === vp ? confirmBtnClass : dangerBtnClass}
                  onClick={(e) => handleDisconnectVault(vp, e)}
                  title={clearConfirmVault === vp ? t('click_again_to_confirm_clear', 'Click again to confirm clear data') : t('disconnect_cmd_click_to_clear', 'Disconnect (Cmd+click to clear data)')}
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
        <div className="text-2.75 font-semibold text-text-secondary uppercase tracking-[0.5px] mb-1.5">{t('preferences', 'Preferences')}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <button className="text-3 font-medium text-accent hover:underline cursor-pointer inline-flex items-center gap-0.5" onClick={() => window.api.openInstructionFile('extraction-prompt')}>
            {t('open_extraction_prompt', 'Open Extraction Prompt')} <span className="text-2.5">↗</span>
          </button>
          <button className="text-3 font-medium text-accent hover:underline cursor-pointer inline-flex items-center gap-0.5" onClick={() => window.api.openInstructionFile('je-instructions')}>
            {t('open_je_instructions', 'Open JE Instructions')} <span className="text-2.5">↗</span>
          </button>
          <button className="text-3 font-medium text-accent hover:underline cursor-pointer inline-flex items-center gap-0.5" onClick={() => window.api.openInstructionFile('config')}>
            {t('open_config', 'Open Configuration')} <span className="text-2.5">↗</span>
          </button>
        </div>
        <div className="mt-2">
          <button className={settingsBtnClass} onClick={handleExportInstructions}>
            {t('export_instructions', 'Export Instructions')}
          </button>
        </div>
        <div className="flex gap-1.5 mt-2">
          <button
            className={locale === 'en' ? localeBtnActiveClass : localeBtnClass}
            onClick={() => changeLocale('en')}
          >{t('locale_en', 'EN')}</button>
          <button
            className={locale === 'vi' ? localeBtnActiveClass : localeBtnClass}
            onClick={() => changeLocale('vi')}
          >{t('locale_vi', 'VI')}</button>
        </div>
        <div className="flex items-center gap-2 mt-2.5">
          <span className="text-3 text-text-secondary whitespace-nowrap">{t('amount_tolerance_vnd', 'Amount tolerance (VND)')}:</span>
          <input
            type="number"
            min={0}
            className="w-20 bg-bg-secondary border border-border rounded px-2 py-0.5 text-3 text-text outline-none focus:border-accent"
            value={toleranceInput ?? String(vaultConfig?.amountTolerance ?? DEFAULT_AMOUNT_TOLERANCE)}
            onChange={(e) => setToleranceInput(e.target.value)}
            onBlur={handleToleranceSave}
            onKeyDown={(e) => { if (e.key === 'Enter') handleToleranceSave(); }}
          />
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
        <div className="text-2.75 font-semibold text-text-secondary uppercase tracking-[0.5px] mb-1.5">{t('about', 'About')}</div>
        <div className="text-3 text-text-secondary">
          <span className="font-medium text-text">{t('invoicevault', 'InvoiceVault')}</span> {appVersion ? t('version_prefix', 'v') + appVersion : ''}
        </div>
        <div className="text-2.75 text-text-muted mt-1">
          {t('about_description', 'Vietnamese VAT invoice management — extract, search, and reconcile')}
        </div>
        <div className="text-2.75 text-text-muted mt-1">
          {t('claude_cli', 'Claude CLI')}: {cliStatus === null
            ? `${t('checking', 'Checking')}...`
            : cliStatus.available
              ? `${cliStatus.version || t('unknown_version', 'unknown version')}`
              : t('not_found', 'Not found')}
        </div>
      </div>

      <div className="h-[1px] bg-border mx-4 my-1" />

      <div className="px-4 py-2.5">
        <button className={dangerBtnClass} onClick={handleQuit}>{t('quit_invoicevault', 'Quit InvoiceVault')}</button>
      </div>
    </div>
  );
};
