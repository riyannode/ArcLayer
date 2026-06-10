import { createMetadataDraft, getMetadataDraft } from '@/lib/a2a/metadata-drafts/store';
import { buildAgentManifest } from '@/lib/agent-onboarding/manifest-builder';
import { createRegistrationIntent, getRegistrationIntent } from '@/lib/agent-onboarding/registration-intents';
import { getOnboardingRolePreset, getOnboardingRolePresets, type OnboardingRolePreset } from '@/lib/agent-onboarding/role-presets';
import { resolveMcpSessionByToken } from '@/lib/agent-accounts/store';
import type { McpSession } from '@/lib/agent-accounts/types';
import { handleCreateApiKey } from './api-key-tools';
import type { McpToolContext } from './registry';
import { MCP_ERRORS, McpError } from './errors';

function baseUrlFromContext(ctx: McpToolContext) {
  return process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '') || ctx.request.origin?.replace(/\/+$/, '') || 'https://arclayers.xyz';
}

async function requireMcpSession(ctx: McpToolContext): Promise<McpSession> {
  const auth = ctx.request.authorization;
  const match = auth?.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1].startsWith('arc_mcp_sess_')) {
    throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'MCP Bearer token required');
  }
  const session = await resolveMcpSessionByToken(match[1].trim());
  if (!session) throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'Invalid or expired MCP session');
  return session;
}

function optionalString(args: Record<string, unknown>, key: string, max: number) {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new McpError(MCP_ERRORS.VALIDATION_ERROR, `${key} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, `${key} must be ${max} characters or fewer`);
  return trimmed || undefined;
}

function stringArray(value: unknown, key: string, max = 12) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, `${key} must be a string array`);
  return value.map((item) => {
    if (typeof item !== 'string') throw new McpError(MCP_ERRORS.VALIDATION_ERROR, `${key} items must be strings`);
    return item.trim();
  }).filter(Boolean).slice(0, max);
}

function linksObject(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'links must be an object');
  const input = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of ['homepage', 'docs', 'repo', 'x', 'twitter']) {
    if (typeof input[key] === 'string' && input[key].trim()) out[key] = input[key].trim().slice(0, 500);
  }
  return out;
}

function rolePresetSummary(preset: OnboardingRolePreset) {
  return {
    id: preset.id,
    title: preset.title,
    label: preset.label,
    identityRole: preset.identityRole,
    mode: preset.mode,
    category: preset.category,
    capabilities: preset.capabilities,
    categories: preset.categories,
    tags: preset.tags,
    jobAccepts: preset.jobAccepts,
  };
}

function draftReadiness() {
  return {
    erc8004: 'mint_required',
    manifest: 'draft_created',
    apiKey: 'after_mint',
    erc8183: 'metadata_ready_runtime_later',
    x402: 'metadata_ready_runtime_later',
    runner: 'not_configured',
    bot: 'not_configured',
    wallet: 'not_configured',
  } as const;
}

function completedReadiness() {
  return {
    erc8004: 'minted',
    manifest: 'finalized',
    apiKey: 'ready_to_create',
    erc8183: 'metadata_ready_runtime_later',
    x402: 'metadata_ready_runtime_later',
    runner: 'not_configured',
    bot: 'not_configured',
    wallet: 'not_configured',
  } as const;
}

async function createBundleDraft(args: Record<string, unknown>, ctx: McpToolContext, defaults: { rolePresetIdRequired: boolean }) {
  const session = await requireMcpSession(ctx);
  const requestedRolePresetId = optionalString(args, 'rolePresetId', 80);
  if (defaults.rolePresetIdRequired && !requestedRolePresetId) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'rolePresetId is required');
  }
  const rolePresetId = requestedRolePresetId || 'provider';
  const preset = getOnboardingRolePreset(rolePresetId);
  if (!preset) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'rolePresetId is disabled or unknown');

  const name = optionalString(args, 'name', 120) || preset.title;
  const description = optionalString(args, 'description', 2000) || preset.description;
  const endpoint = optionalString(args, 'endpoint', 500);
  const avatar = optionalString(args, 'avatar', 1000);
  const customCapabilities = stringArray(args.customCapabilities, 'customCapabilities', 12);
  const links = linksObject(args.links);
  const baseUrl = baseUrlFromContext(ctx);

  const manifest = buildAgentManifest({
    agentId: `pending-${preset.id}`,
    name,
    rolePresetId: preset.id,
    description,
    controller: session.ownerAddress,
    endpoint,
    avatar,
    customCapabilities,
    links,
  });

  const draft = await createMetadataDraft({ controller: session.ownerAddress, metadata: manifest });
  if (!draft.ok) throw new McpError(MCP_ERRORS.INTERNAL_ERROR, `metadata_draft_failed: ${draft.error}`);

  const intent = await createRegistrationIntent({
    mcpSessionId: session.id,
    ownerAddress: session.ownerAddress,
    draftId: draft.draftId,
    rolePresetId: preset.id,
  });
  if (!intent.ok) throw new McpError(MCP_ERRORS.INTERNAL_ERROR, `registration_intent_failed: ${intent.error}`);

  const metadataURI = `${baseUrl}/api/a2a/metadata/draft/${draft.draftId}`;
  const registrationUrl = `${baseUrl}/register/erc8004?intent=${intent.intent.id}&mcp=1`;

  return { session, preset, manifest, draft, intent: intent.intent, metadataURI, registrationUrl, baseUrl };
}

function assertIntentBelongsToSession(intent: { mcpSessionId: string; ownerAddress: string }, session: McpSession) {
  const sameSession = intent.mcpSessionId === session.id;
  const sameOwner = intent.ownerAddress.toLowerCase() === session.ownerAddress.toLowerCase();
  if (!sameSession && !sameOwner) {
    throw new McpError(MCP_ERRORS.FORBIDDEN, 'registration intent does not belong to this MCP session');
  }
}

export async function handleListOnboardingRolePresets(args: Record<string, unknown>) {
  const includeDisabled = args.includeDisabled === true;
  return {
    ok: true,
    presets: getOnboardingRolePresets({ includeDisabled }).map((preset) => ({
      id: preset.id,
      title: preset.title,
      label: preset.label,
      description: preset.description,
      role: preset.identityRole,
      category: preset.category,
      capabilities: preset.capabilities,
      categories: preset.categories,
      tags: preset.tags,
      enabled: preset.enabled,
    })),
  };
}

export async function handleCreateRegistrationDraft(args: Record<string, unknown>, ctx: McpToolContext) {
  const bundle = await createBundleDraft(args, ctx, { rolePresetIdRequired: true });

  return {
    ok: true,
    intentId: bundle.intent.id,
    draftId: bundle.draft.draftId,
    metadataURI: bundle.metadataURI,
    registrationUrl: bundle.registrationUrl,
    manifestPreview: bundle.manifest,
    next: [
      'This is the legacy registration-draft flow. New users should prefer onboarding.start_agent_bundle.',
      'Open registrationUrl in the browser with the same owner wallet session and mint the ERC-8004 identity.',
      'After mint/finalize succeeds, call onboarding.get_agent_bundle_status.',
      'Then call onboarding.create_agent_runtime_key for the completed agent bundle.',
    ],
  };
}

export async function handleStartAgentBundle(args: Record<string, unknown>, ctx: McpToolContext) {
  const bundle = await createBundleDraft(args, ctx, { rolePresetIdRequired: false });

  return {
    ok: true,
    bundleStatus: 'draft',
    intentId: bundle.intent.id,
    draftId: bundle.draft.draftId,
    metadataURI: bundle.metadataURI,
    registrationUrl: bundle.registrationUrl,
    rolePreset: rolePresetSummary(bundle.preset),
    manifestPreview: bundle.manifest,
    readiness: draftReadiness(),
    next: [
      'Open registrationUrl in ArcLayer web.',
      'Connect the same owner wallet.',
      'Sign/mint the ERC-8004 identity.',
      'After finalize, call onboarding.get_agent_bundle_status.',
      'Then call onboarding.create_agent_runtime_key.',
    ],
  };
}

export async function handleGetAgentBundleStatus(args: Record<string, unknown>, ctx: McpToolContext) {
  const session = await requireMcpSession(ctx);
  const intentId = optionalString(args, 'intentId', 120);
  if (!intentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'intentId is required');

  const intent = await getRegistrationIntent(intentId);
  if (!intent) throw new McpError(MCP_ERRORS.NOT_FOUND, 'registration intent not found');
  assertIntentBelongsToSession(intent, session);

  const baseUrl = baseUrlFromContext(ctx);
  const draft = await getMetadataDraft(intent.draftId);
  const preset = getOnboardingRolePreset(intent.rolePresetId, { includeDisabled: true }) ?? getOnboardingRolePreset('provider', { includeDisabled: true })!;
  const metadataURI = `${baseUrl}/api/a2a/metadata/draft/${intent.draftId}`;
  const registrationUrl = `${baseUrl}/register/erc8004?intent=${intent.id}&mcp=1`;

  if (intent.status === 'completed' && intent.agentId && intent.txHash) {
    return {
      ok: true,
      status: 'completed',
      completed: true,
      intentId: intent.id,
      draftId: intent.draftId,
      agentId: intent.agentId,
      txHash: intent.txHash,
      rolePresetId: intent.rolePresetId,
      rolePreset: rolePresetSummary(preset),
      metadataURI,
      manifestURI: `arclayer://manifest/${intent.agentId}`,
      dashboardUrl: `${baseUrl}/agents/${intent.agentId}`,
      readiness: completedReadiness(),
    };
  }

  if (new Date(intent.expiresAt).getTime() < Date.now()) {
    return {
      ok: true,
      status: 'expired',
      completed: false,
      intentId: intent.id,
      draftId: intent.draftId,
      rolePresetId: intent.rolePresetId,
      rolePreset: rolePresetSummary(preset),
      registrationUrl,
      metadataURI,
      draftStatus: draft?.status ?? 'missing',
      next: 'Create a new agent bundle registration intent.',
    };
  }

  return {
    ok: true,
    status: 'draft',
    completed: false,
    intentId: intent.id,
    draftId: intent.draftId,
    rolePresetId: intent.rolePresetId,
    rolePreset: rolePresetSummary(preset),
    registrationUrl,
    metadataURI,
    draftStatus: draft?.status ?? 'missing',
    readiness: draftReadiness(),
    next: 'Open registrationUrl and sign/mint in ArcLayer web.',
  };
}

export async function handleCreateAgentRuntimeKey(args: Record<string, unknown>, ctx: McpToolContext) {
  const session = await requireMcpSession(ctx);
  const intentId = optionalString(args, 'intentId', 120);
  const explicitAgentId = optionalString(args, 'agentId', 128);
  const explicitPreset = optionalString(args, 'preset', 80);
  const label = optionalString(args, 'label', 80);

  let resolvedAgentId = explicitAgentId;
  let resolvedPreset = explicitPreset || 'provider';

  if (intentId) {
    const intent = await getRegistrationIntent(intentId);
    if (!intent) throw new McpError(MCP_ERRORS.NOT_FOUND, 'registration intent not found');
    assertIntentBelongsToSession(intent, session);
    if (intent.status !== 'completed' || !intent.agentId) {
      throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'Agent Bundle registration is not completed yet. Mint in ArcLayer web, then retry.');
    }
    if (explicitAgentId && explicitAgentId !== intent.agentId) {
      throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'agentId does not match completed registration intent');
    }
    resolvedAgentId = intent.agentId;
    resolvedPreset = explicitPreset || intent.rolePresetId || 'provider';
  }

  if (!resolvedAgentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'intentId or agentId is required');

  const result = await handleCreateApiKey(
    {
      agentId: resolvedAgentId,
      preset: resolvedPreset,
      label: label || `agent-bundle-${resolvedPreset}`,
    },
    ctx,
  ) as Record<string, unknown>;

  return {
    ...result,
    warning: 'Store the key now — it will not be shown again.',
    next: [
      'Runner, bot runtime, payer wallet, and live x402/ERC-8183 execution are configured later.',
    ],
  };
}
