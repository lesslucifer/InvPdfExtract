import React, { useState, useCallback, useEffect } from 'react';
import { t } from '../lib/i18n';
import { AppConfig, AIProviderType, DeepseekModel } from '../shared/types';
import { useAppConfig, useCliStatus } from '../lib/queries';

interface Props {
  config: AppConfig;
}

const settingsBtnClass = 'bg-bg-secondary border border-border rounded-md px-2.5 py-1 inline-flex items-center gap-1 text-3 font-medium text-text cursor-pointer transition-colors hover:bg-bg-hover';
const providerActiveClass = 'bg-accent border border-accent rounded-md px-2.5 py-1 inline-flex items-center gap-1 text-3 font-medium text-white cursor-pointer hover:opacity-85';
const providerInactiveClass = 'bg-bg-secondary border border-accent/30 rounded-md px-2.5 py-1 inline-flex items-center gap-1 text-3 font-medium text-accent cursor-pointer transition-colors hover:bg-accent/10';

export const AIProviderSection: React.FC<Props> = ({ config }) => {
  const [apiKeyDraft, setApiKeyDraft] = useState<string>(config.deepseekApiKey ?? '');
  const [revealKey, setRevealKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    setApiKeyDraft(config.deepseekApiKey ?? '');
  }, [config.deepseekApiKey]);

  const updateProvider = useCallback(async (aiProvider: AIProviderType) => {
    await window.api.updateAiConfig({ aiProvider });
    useAppConfig.invalidate();
    useCliStatus.invalidate();
  }, []);

  const updateModel = useCallback(async (deepseekModel: DeepseekModel) => {
    await window.api.updateAiConfig({ deepseekModel });
    useAppConfig.invalidate();
    useCliStatus.invalidate();
  }, []);

  const updateThinking = useCallback(async (deepseekThinking: boolean) => {
    await window.api.updateAiConfig({ deepseekThinking });
    useAppConfig.invalidate();
  }, []);

  const saveApiKey = useCallback(async () => {
    const trimmed = apiKeyDraft.trim();
    if (trimmed === (config.deepseekApiKey ?? '')) return;
    await window.api.updateAiConfig({ deepseekApiKey: trimmed.length > 0 ? trimmed : null });
    useAppConfig.invalidate();
    useCliStatus.invalidate();
  }, [apiKeyDraft, config.deepseekApiKey]);

  const testConnection = useCallback(async () => {
    setTestStatus('testing');
    setTestError(null);
    const trimmed = apiKeyDraft.trim();
    if (trimmed.length === 0) {
      setTestStatus('error');
      setTestError(t('deepseek_test_no_key', 'Enter an API key first'));
      return;
    }
    if (trimmed !== (config.deepseekApiKey ?? '')) {
      await window.api.updateAiConfig({ deepseekApiKey: trimmed });
      useAppConfig.invalidate();
    }
    const result = await window.api.testDeepseekKey(trimmed, config.deepseekModel);
    if (result.ok) {
      setTestStatus('success');
    } else {
      setTestStatus('error');
      setTestError(result.error ?? t('unknown_error', 'Unknown error'));
    }
  }, [apiKeyDraft, config.deepseekApiKey, config.deepseekModel]);

  const isDeepseek = config.aiProvider === 'deepseek-api';

  return (
    <div className="px-4 py-2.5">
      <div className="text-2.75 font-semibold text-text-secondary uppercase tracking-[0.5px] mb-1.5">
        {t('ai_provider', 'AI Provider')}
      </div>
      <div className="flex gap-1.5 mb-2">
        <button
          className={config.aiProvider === 'claude-cli' ? providerActiveClass : providerInactiveClass}
          onClick={() => updateProvider('claude-cli')}
        >{t('provider_claude_cli', 'Claude Code CLI')}</button>
        <button
          className={isDeepseek ? providerActiveClass : providerInactiveClass}
          onClick={() => updateProvider('deepseek-api')}
        >{t('provider_deepseek', 'DeepSeek API')}</button>
      </div>

      {isDeepseek && (
        <div className="flex flex-col gap-2 mt-2">
          <div className="flex items-center gap-2">
            <span className="text-3 text-text-secondary whitespace-nowrap w-24">{t('deepseek_api_key', 'API key')}:</span>
            <input
              type={revealKey ? 'text' : 'password'}
              className="flex-1 bg-bg-secondary border border-border rounded px-2 py-0.5 text-3 text-text outline-none focus:border-accent"
              value={apiKeyDraft}
              placeholder="sk-..."
              onChange={(e) => setApiKeyDraft(e.target.value)}
              onBlur={saveApiKey}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
            <button
              className={settingsBtnClass}
              onClick={() => setRevealKey(v => !v)}
            >{revealKey ? t('hide', 'Hide') : t('show', 'Show')}</button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-3 text-text-secondary whitespace-nowrap w-24">{t('deepseek_model', 'Model')}:</span>
            <select
              className="bg-bg-secondary border border-border rounded px-2 py-0.5 text-3 text-text outline-none focus:border-accent"
              value={config.deepseekModel}
              onChange={(e) => updateModel(e.target.value as DeepseekModel)}
            >
              <option value="deepseek-v4-flash">{t('deepseek_v4_flash', 'DeepSeek V4 Flash (fast)')}</option>
              <option value="deepseek-v4-pro">{t('deepseek_v4_pro', 'DeepSeek V4 Pro (more capable)')}</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="deepseek-thinking"
              type="checkbox"
              checked={config.deepseekThinking}
              onChange={(e) => updateThinking(e.target.checked)}
            />
            <label htmlFor="deepseek-thinking" className="text-3 text-text cursor-pointer">
              {t('deepseek_thinking', 'Enable thinking mode (slower, more accurate)')}
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button className={settingsBtnClass} onClick={testConnection} disabled={testStatus === 'testing'}>
              {testStatus === 'testing' ? t('testing', 'Testing...') : t('test_connection', 'Test connection')}
            </button>
            {testStatus === 'success' && (
              <span className="text-3 text-confidence-high">{t('connection_ok', 'Connected')}</span>
            )}
            {testStatus === 'error' && (
              <span className="text-3 text-confidence-low">{testError}</span>
            )}
          </div>

          <div className="text-2.75 text-text-muted mt-1">
            {t('deepseek_storage_note', 'API key is stored locally in plain text under app userData.')}
          </div>
        </div>
      )}
    </div>
  );
};
