import type { AgentApiProviderConfig, AgentProviderSettings } from "./types";

export const OPENAI_COMPATIBLE_PROVIDER_ID = "openai_compatible";
export const ANTHROPIC_API_PROVIDER_ID = "anthropic_api";

export function defaultAgentProviderSettings(): AgentProviderSettings {
  return {
    defaultProviderId: "codex_cli",
    apiProviders: [
      {
        id: OPENAI_COMPATIBLE_PROVIDER_ID,
        kind: "openai_compatible",
        name: "OpenAI-compatible API",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1",
        apiKey: "",
        enabled: false,
      },
      {
        id: ANTHROPIC_API_PROVIDER_ID,
        kind: "anthropic_api",
        name: "Anthropic API",
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-3-5-sonnet-latest",
        apiKey: "",
        enabled: false,
      },
    ],
  };
}

export function normalizeAgentProviderSettings(settings: AgentProviderSettings | undefined): AgentProviderSettings {
  const defaults = defaultAgentProviderSettings();
  const incomingProviders = settings?.apiProviders ?? [];
  const apiProviders = defaults.apiProviders.map((defaultProvider) => {
    const saved = incomingProviders.find((provider) => provider.id === defaultProvider.id);
    return saved ? { ...defaultProvider, ...saved, kind: defaultProvider.kind } : defaultProvider;
  });
  for (const provider of incomingProviders) {
    if (!apiProviders.some((item) => item.id === provider.id)) {
      apiProviders.push(provider);
    }
  }

  return {
    defaultProviderId: settings?.defaultProviderId || defaults.defaultProviderId,
    apiProviders,
  };
}

export function isAgentApiProviderConfigured(provider: AgentApiProviderConfig): boolean {
  return Boolean(
    provider.enabled &&
      provider.baseUrl.trim() &&
      provider.model.trim() &&
      provider.apiKey.trim(),
  );
}
