export type ApiKeyPresetId = 'provider' | 'client' | 'evaluator';

export type ApiKeyPreset = {
  id: ApiKeyPresetId;
  scopes: string[];
  installCommand: string;
};

export const API_KEY_PRESETS: Record<ApiKeyPresetId, ApiKeyPreset> = {
  provider: {
    id: 'provider',
    scopes: ['erc8183:claim', 'erc8183:running', 'erc8183:submit', 'erc8183:tx', 'erc8183:presence'],
    installCommand: 'curl -fsSL https://arclayers.xyz/install/erc8183-provider.sh | bash',
  },
  client: {
    id: 'client',
    scopes: ['erc8183:create', 'erc8183:confirm', 'erc8183:tx', 'erc8183:presence'],
    installCommand: 'curl -fsSL https://arclayers.xyz/install/erc8183-provider.sh | bash',
  },
  evaluator: {
    id: 'evaluator',
    scopes: ['erc8183:complete', 'erc8183:reject', 'erc8183:tx', 'erc8183:presence'],
    installCommand: 'curl -fsSL https://arclayers.xyz/install/erc8183-provider.sh | bash',
  },
};

export const API_KEY_PRESET_IDS = Object.keys(API_KEY_PRESETS) as ApiKeyPresetId[];
export const API_KEY_PRESET_ID_SET = new Set<string>(API_KEY_PRESET_IDS);

export function getApiKeyPreset(id: string | null | undefined): ApiKeyPreset | null {
  const key = String(id || '').trim().toLowerCase();
  return API_KEY_PRESET_ID_SET.has(key) ? API_KEY_PRESETS[key as ApiKeyPresetId] : null;
}

export function buildApiKeyEnvSnippet(input: { key: string; agentId: string; baseUrl?: string; preset: string }) {
  const baseUrl = input.baseUrl?.replace(/\/+$/, '') || process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '') || 'https://arclayers.xyz';
  return [
    `ARCLAYER_API_KEY=${input.key}`,
    `ARCLAYER_AGENT_ID=${input.agentId}`,
    `ARCLAYER_BASE_URL=${baseUrl}`,
    `ARCLAYER_MODE=${input.preset}`,
  ].join('\n');
}
