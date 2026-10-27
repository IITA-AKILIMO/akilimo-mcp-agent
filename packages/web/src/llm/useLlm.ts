import { useCallback, useEffect, useRef, useState } from 'react';
import { read, write } from '../mcp/keys';
import { fetchModels, fetchProviders, testProvider, type LlmTest, type ProviderId, type ProviderOption } from './api';

export type LlmTestState = { running: true } | { running: false; result: LlmTest } | null;

// Choices remembered in this browser: the provider and the last model per provider
interface StoredSettings { provider: ProviderId | ''; models: Partial<Record<ProviderId, string>> }
const SETTINGS = 'llm-settings';
const loadSettings = (): StoredSettings => {
  const stored = read<Partial<StoredSettings>>(SETTINGS, {});
  return { provider: stored.provider ?? '', models: stored.models ?? {} };
};

// The providers an admin has set up on the server, the selected provider and model, and the model
// list fetched live from the server. `enabled` is false while the user still has to sign in.
export function useLlm(enabled: boolean) {
  const [settings, setSettings] = useState(loadSettings);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const updateSettings = (change: (prev: StoredSettings) => StoredSettings) =>
    setSettings(prev => {
      const next = change(prev);
      write(SETTINGS, next);
      return next;
    });

  // Only providers that are turned on and have what they need (admins see the rest in Manage)
  const loadProviders = useCallback(async () => {
    if (!enabled) { setProviders([]); setIsAdmin(false); return; }
    try {
      const { admin, providers: list } = await fetchProviders();
      setIsAdmin(admin);
      setProviders(list.filter(p => !('configured' in p) || (p.enabled && p.configured)).map(({ id, label }) => ({ id, label })));
      setError(null);
    } catch (e) {
      setProviders([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [enabled]);
  useEffect(() => { loadProviders(); }, [loadProviders]);

  // Remembered provider if it is still available, otherwise the first one (Ollama comes first)
  const provider: ProviderId | '' = providers.some(p => p.id === settings.provider) ? settings.provider as ProviderId : providers[0]?.id ?? '';
  const label = providers.find(p => p.id === provider)?.label ?? '';

  const setModel = useCallback((model: string, forProvider: ProviderId | '' = provider) => {
    if (forProvider) updateSettings(prev => ({ ...prev, models: { ...prev.models, [forProvider]: model } }));
  }, [provider]);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setError(null);
    setModels([]);
    if (!provider) return;
    setLoading(true);
    try {
      const { models: list, default: preferred } = await fetchModels(provider);
      if (id !== requestId.current) return;
      setModels(list);
      const remembered = loadSettings().models[provider];
      if (!remembered || !list.includes(remembered)) setModel(preferred ?? '', provider);
      if (list.length === 0) {
        setError(provider === 'ollama' ? 'No Ollama model with tool support found. An admin can download one under Provider settings.' : `No chat models found on ${label}.`);
      }
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [provider, label, setModel]);
  useEffect(() => { refresh(); }, [refresh]);

  const remembered = provider ? settings.models[provider] ?? '' : '';
  const model = models.includes(remembered) ? remembered : '';

  // A result describes one provider; drop it when the provider changes
  const [test, setTest] = useState<LlmTestState>(null);
  useEffect(() => setTest(null), [provider]);
  const runTest = async () => {
    if (!provider) return;
    setTest({ running: true });
    try {
      const result = await testProvider(provider, model);
      setTest({ running: false, result });
      // The test also lists models; pick up any that appeared (e.g. after a pull)
      if (result.ok && result.models !== models.length) refresh();
    } catch (e) {
      setTest({ running: false, result: { ok: false, ms: 0, error: e instanceof Error ? e.message : String(e) } });
    }
  };

  return {
    providers,
    provider,
    isAdmin,
    models,
    model,
    loading,
    error,
    setProvider: (id: ProviderId) => updateSettings(prev => ({ ...prev, provider: id })),
    setModel: (m: string) => setModel(m),
    refresh,
    reloadProviders: loadProviders,
    test,
    runTest,
    // Saved with conversations
    label: model ? (provider === 'ollama' ? model : `${provider}:${model}`).slice(0, 100) : '',
  };
}
