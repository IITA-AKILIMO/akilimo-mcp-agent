import { useCallback, useEffect, useRef, useState } from 'react';
import {
  chat, listModels, loadProviderKeys, loadSettings, missingSetup, pickDefaultModel, providerInfo, saveProviderKey, saveSettings,
  testConnection, type LlmConfig, type LlmTest, type ProviderId,
} from './providers';

export type LlmTestState = { running: true } | { running: false; result: LlmTest } | null;
import type { ChatMessage, ToolSpec } from './types';

// Selected provider and model for the chat, with the provider's models fetched live. Keys and URLs
// are typed in, so listing waits until the user pauses.
export function useLlm() {
  const [settings, setSettings] = useState(loadSettings);
  const [keys, setKeys] = useState(loadProviderKeys);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  const requestId = useRef(0);

  const { provider, baseUrl } = settings;
  const key = keys[provider] ?? '';
  const info = providerInfo(provider);

  const updateSettings = (change: (prev: typeof settings) => typeof settings) =>
    setSettings(prev => {
      const next = change(prev);
      saveSettings(next);
      return next;
    });

  const setModel = useCallback((model: string, forProvider: ProviderId = provider) =>
    updateSettings(prev => ({ ...prev, models: { ...prev.models, [forProvider]: model } })), [provider]);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const config: LlmConfig = { provider, key, baseUrl };
    const missing = missingSetup(config);
    setSetup(missing);
    setError(null);
    setModels([]);
    if (missing) return;
    setLoading(true);
    try {
      const list = await listModels(config);
      if (id !== requestId.current) return;
      setModels(list);
      const remembered = loadSettings().models[provider];
      if (!remembered || !list.includes(remembered)) setModel(pickDefaultModel(provider, list) ?? '', provider);
      if (list.length === 0) {
        setError(provider === 'ollama' ? 'No Ollama model with tool support found. Run: ollama pull qwen3:8b' : `No chat models found on ${info.label}.`);
      }
    } catch (e) {
      if (id !== requestId.current) return;
      setError(provider === 'ollama'
        ? 'Cannot reach Ollama. Make sure it is running (default http://localhost:11434).'
        : e instanceof Error ? e.message : String(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [provider, key, baseUrl, info.label, setModel]);

  // Immediately on a provider switch, after a pause while a key or URL is being typed
  const lastProvider = useRef(provider);
  useEffect(() => {
    const switched = lastProvider.current !== provider;
    lastProvider.current = provider;
    const timer = setTimeout(refresh, switched ? 0 : 600);
    return () => clearTimeout(timer);
  }, [refresh, provider]);

  const remembered = settings.models[provider] ?? '';
  const model = models.includes(remembered) ? remembered : '';

  // A result describes one provider/key/URL combination; drop it when any of them changes
  const [test, setTest] = useState<LlmTestState>(null);
  useEffect(() => setTest(null), [provider, key, baseUrl]);
  const runTest = async () => {
    setTest({ running: true });
    const result = await testConnection({ provider, key, baseUrl }, model);
    setTest({ running: false, result });
    // The test also lists models; pick up any that appeared (e.g. after a pull or a new key)
    if (result.ok && result.models !== models.length) refresh();
  };

  return {
    provider,
    info,
    key,
    baseUrl,
    models,
    model,
    loading,
    error,
    setup, // what the user must enter first, if anything
    setProvider: (id: ProviderId) => updateSettings(prev => ({ ...prev, provider: id })),
    setModel: (m: string) => setModel(m),
    setKey: (value: string) => {
      setKeys(prev => ({ ...prev, [provider]: value }));
      saveProviderKey(provider, value);
    },
    setBaseUrl: (url: string) => updateSettings(prev => ({ ...prev, baseUrl: url.trim() })),
    refresh,
    test,
    runTest,
    // Bound to the current provider and model, for the agent loop
    chat: (messages: ChatMessage[], tools: ToolSpec[], signal?: AbortSignal) => chat({ provider, key, baseUrl }, model, messages, tools, signal),
    // Saved with conversations
    label: model ? (provider === 'ollama' ? model : `${provider}:${model}`).slice(0, 100) : '',
  };
}
