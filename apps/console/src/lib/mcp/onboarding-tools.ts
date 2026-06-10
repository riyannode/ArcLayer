import { createMetadataDraft } from '@/lib/a2a/metadata-drafts/store';
import { buildAgentManifest } from '@/lib/agent-onboarding/manifest-builder';
import { createRegistrationIntent } from '@/lib/agent-onboarding/registration-intents';
import { getOnboardingRolePreset, getOnboardingRolePresets } from '@/lib/agent-onboarding/role-presets';
import { resolveMcpSessionByToken } from '@/lib/agent-accounts/store';
import type { McpSession } from '@/lib/agent-accounts/types';
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
  const session = await requireMcpSession(ctx);
  const rolePresetId = optionalString(args, 'rolePresetId', 80) || 'provider';
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

  return {
    ok: true,
    intentId: intent.intent.id,
    draftId: draft.draftId,
    metadataURI,
    registrationUrl,
    manifestPreview: manifest,
    next: [
      'Open registrationUrl in the browser with the same owner wallet session.',
      'Mint the ERC-8004 identity in /register/erc8004.',
      'After mint/finalize succeeds, call provider.create_api_key for the new agentId.',
      'Return the PM2 .env snippet to the user. The finalized manifest is upserted for dashboard visibility.',
    ],
  };
}
