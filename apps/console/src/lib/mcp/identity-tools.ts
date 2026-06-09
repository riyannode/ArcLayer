/**
 * MCP Identity Tools — ERC-8004 identity registration via feature-gated Passkey Agent Account mode.
 *
 * This is an optional future identity path, not the default EOA registration flow.
 *
 * Product model:
 * - Owner wallet/passkey = user/admin
 * - Agent Account = Circle Smart Account / controller
 * - ERC-8004 identity minted TO Agent Account, not owner wallet
 * - MCP only prepares approval/calldata/status
 * - Actual signing/execution happens via frontend Circle passkey bridge (PR 454)
 *
 * Source of truth for Agent Account:
 * - session.agentAccountAddress (set at session creation time)
 * - NOT fetched fresh from DB each call — session is the binding
 * - If session's agent account is inactive/revoked, the session itself should be revoked
 */

import { encodeFunctionData, keccak256, toBytes, getAddress, type Hex } from 'viem';
import {
  ERC8004_IDENTITY_REGISTRY_ABI,
  CONTRACTS,
} from '@arclayer/sdk';
import { resolveMcpSessionByToken, getActiveAgentAccountForOwnerAndAddress } from '@/lib/agent-accounts/store';
import { getApproval, getEffectiveStatus, createApproval } from '@/lib/mcp/approvals';
import type { McpSession } from '@/lib/agent-accounts/types';
import type { McpToolContext } from './registry';
import { MCP_ERRORS, McpError } from './errors';

// ── Constants ─────────────────────────────────────────────────────────────

const ARC_CHAIN_ID = 5042002;
const ERC8004_ADDRESS = getAddress(CONTRACTS.ERC8004_IDENTITY_REGISTRY);
const REGISTER_SELECTOR = '0x46d7c549'; // keccak256("register(string)") first 4 bytes
const MAX_NAME_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_CAPABILITIES = 20;
const MAX_ENDPOINT_LENGTH = 512;

const ALLOWED_ROLES = new Set([
  'provider',
  'client',
  'evaluator',
  'agent',
  'oracle',
  'analyzer',
  'executor',
  'worker',
  'buyer',
  'settler',
]);

// ── Session auth helper ───────────────────────────────────────────────────

/**
 * Extract and validate MCP session from tool context.
 * Throws McpError if not authenticated.
 */
export async function requireMcpSession(ctx: McpToolContext): Promise<McpSession> {
  const auth = ctx.request.authorization;
  if (!auth) {
    throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'MCP Bearer token required');
  }

  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1].startsWith('arc_mcp_sess_')) {
    throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'Invalid MCP token format');
  }

  const session = await resolveMcpSessionByToken(match[1].trim());
  if (!session) {
    throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'Invalid or expired MCP session');
  }

  return session;
}

/**
 * Validate that the session's agent account binding is still active in DB.
 * Checks owner_address + agent_account_address + status=active.
 * session.agentAccountAddress is the source of truth.
 * This check is optional — only call when you need to confirm the binding is still live.
 */
async function validateAgentAccountActive(session: McpSession): Promise<void> {
  const agentAccount = await getActiveAgentAccountForOwnerAndAddress(
    session.ownerAddress,
    session.agentAccountAddress,
  );
  if (!agentAccount) {
    throw new McpError(
      MCP_ERRORS.FORBIDDEN,
      'agent_account_inactive_or_revoked — session agent account is no longer active or owner mismatch',
    );
  }
}

function assertMcpAgentAccountIdentityEnabled(): void {
  if (process.env.MCP_AGENT_ACCOUNT_IDENTITY_ENABLED !== 'true') {
    throw new McpError(
      MCP_ERRORS.FORBIDDEN,
      'agent_account_mcp_disabled — Agent Account identity mode is temporarily disabled. Use EOA registration.',
    );
  }
}

// ── Metadata validation ───────────────────────────────────────────────────

export interface ValidatedMetadata {
  name: string;
  role: string;
  capabilities: string[];
  description: string;
  endpoint?: string;
}

/**
 * Validate metadata input for identity registration.
 * Returns sanitized metadata or throws McpError.
 */
export function validateMetadata(input: Record<string, unknown>): ValidatedMetadata {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'name is required');
  if (name.length > MAX_NAME_LENGTH) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, `name exceeds ${MAX_NAME_LENGTH} chars`);

  const role = typeof input.role === 'string' ? input.role.trim().toLowerCase() : '';
  if (!role) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'role is required');
  if (!ALLOWED_ROLES.has(role)) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, `role not allowed: ${role}. Allowed: ${[...ALLOWED_ROLES].join(', ')}`);
  }

  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'capabilities must be a non-empty array');
  }
  if (input.capabilities.length > MAX_CAPABILITIES) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, `capabilities exceeds ${MAX_CAPABILITIES} items`);
  }
  const capabilities = input.capabilities
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (capabilities.length === 0) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'capabilities must contain at least one non-empty string');
  }

  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (!description) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'description is required');
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, `description exceeds ${MAX_DESCRIPTION_LENGTH} chars`);
  }

  let endpoint: string | undefined;
  if (input.endpoint !== undefined && input.endpoint !== null) {
    const ep = String(input.endpoint).trim();
    if (ep) {
      try {
        new URL(ep);
        if (ep.length > MAX_ENDPOINT_LENGTH) {
          throw new McpError(MCP_ERRORS.VALIDATION_ERROR, `endpoint exceeds ${MAX_ENDPOINT_LENGTH} chars`);
        }
        endpoint = ep;
      } catch {
        throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'endpoint must be a valid URL');
      }
    }
  }

  const totalSize = JSON.stringify(input).length;
  if (totalSize > 8192) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'payload too large (max 8192 chars)');
  }

  return { name, role, capabilities, description, ...(endpoint ? { endpoint } : {}) };
}

// ── Metadata URI ──────────────────────────────────────────────────────────

export function buildMetadataURI(metadata: ValidatedMetadata): { uri: string; hash: string; json: string } {
  const json = JSON.stringify(metadata, null, 0);
  const hash = keccak256(toBytes(json));
  const uri = `arclayer://mcp/identity/${hash}`;
  return { uri, hash, json };
}

// ── Calldata builder ──────────────────────────────────────────────────────

export function buildRegisterCalldata(metadataURI: string): Hex {
  return encodeFunctionData({
    abi: ERC8004_IDENTITY_REGISTRY_ABI as any,
    functionName: 'register',
    args: [metadataURI],
  });
}

// ── Tool implementations ──────────────────────────────────────────────────

/**
 * identity.get_agent_account — Read tool.
 * Returns the agent account from the session.
 * Validates the binding is still active in DB.
 */
export async function handleGetAgentAccount(
  _args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  assertMcpAgentAccountIdentityEnabled();

  // Validate binding is still active
  await validateAgentAccountActive(session);

  return {
    ok: true,
    ownerAddress: session.ownerAddress,
    agentAccountAddress: session.agentAccountAddress,
    controllerAddress: session.agentAccountAddress,
    chainId: ARC_CHAIN_ID,
    note: 'ERC-8004 identity will be minted to agentAccountAddress (Circle Smart Account), not ownerAddress.',
  };
}

/**
 * identity.prepare_register_agent_for_session — Tx instruction tool.
 * Validates metadata, builds encoded calldata for register(metadataURI).
 * Does NOT create approval or execute tx.
 */
export async function handlePrepareRegisterAgent(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  assertMcpAgentAccountIdentityEnabled();
  await validateAgentAccountActive(session);
  const metadata = validateMetadata(args);
  const { uri: metadataURI, hash: metadataHash } = buildMetadataURI(metadata);

  const data = buildRegisterCalldata(metadataURI);

  return {
    ok: true,
    ownerAddress: session.ownerAddress,
    agentAccountAddress: session.agentAccountAddress,
    controllerAddress: session.agentAccountAddress,
    chainId: ARC_CHAIN_ID,
    contract: 'ERC8004_IDENTITY_REGISTRY',
    toAddress: ERC8004_ADDRESS,
    data,
    value: '0x0',
    metadataURI,
    metadataHash,
    metadata,
    selector: REGISTER_SELECTOR,
    warning: 'Identity will be minted to agentAccountAddress (Circle Smart Account), not ownerAddress. No tx execution here — use request_register_agent_approval to create an approval.',
  };
}

/**
 * identity.request_register_agent_approval — Prepare + approval in one call.
 * Validates metadata → builds calldata → creates approval via approval engine.
 * Returns approval ID for tracking.
 */
export async function handleRequestRegisterAgentApproval(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  assertMcpAgentAccountIdentityEnabled();
  await validateAgentAccountActive(session);
  const metadata = validateMetadata(args);
  const { uri: metadataURI, hash: metadataHash } = buildMetadataURI(metadata);

  const data = buildRegisterCalldata(metadataURI);

  // Create approval via approval engine (policy enforced internally)
  const result = await createApproval({
    session,
    contract: 'ERC8004_IDENTITY_REGISTRY',
    action: 'identity.register',
    chainId: ARC_CHAIN_ID,
    toAddress: ERC8004_ADDRESS,
    data,
    value: '0x0',
    summary: {
      type: 'identity_register',
      metadata,
      metadataURI,
      metadataHash,
      ownerAddress: session.ownerAddress,
      agentAccountAddress: session.agentAccountAddress,
      controllerAddress: session.agentAccountAddress,
    },
  });

  if (!result.ok) {
    throw new McpError(
      MCP_ERRORS.FORBIDDEN,
      `Approval creation failed: ${result.error}${result.detail ? ` — ${result.detail}` : ''}`,
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '') || 'https://arclayers.xyz';
  const approvalUrl = `${baseUrl}/mcp/approvals/${result.approval.id}`;

  return {
    ok: true,
    approvalId: result.approval.id,
    approvalUrl,
    ownerAddress: session.ownerAddress,
    agentAccountAddress: session.agentAccountAddress,
    controllerAddress: session.agentAccountAddress,
    metadataURI,
    metadataHash,
    summary: result.approval.summary,
    status: 'pending_user_approval' as const,
    expiresAt: result.approval.expiresAt,
    action: result.approval.action,
    note: 'Approval created. Open approvalUrl to approve and execute with Circle passkey. Use identity.get_registration_status to check progress.',
  };
}

/**
 * identity.get_registration_status — Read tool.
 * Accepts approvalId (required). Returns approval status.
 */
export async function handleGetRegistrationStatus(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  assertMcpAgentAccountIdentityEnabled();

  const approvalId = typeof args.approvalId === 'string' ? args.approvalId.trim() : '';
  if (!approvalId) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'approvalId required');
  }

  const approval = await getApproval(approvalId, session.id);
  if (!approval) {
    return { ok: false, error: 'approval_not_found', detail: 'Approval not found or belongs to different session.' };
  }

  const effectiveStatus = getEffectiveStatus(approval);

  return {
    ok: true,
    approvalId: approval.id,
    status: effectiveStatus,
    action: approval.action,
    ownerAddress: approval.ownerAddress,
    agentAccountAddress: approval.agentAccountAddress,
    controllerAddress: approval.agentAccountAddress,
    toAddress: approval.toAddress,
    txHash: approval.txHash,
    error: approval.error,
    createdAt: approval.createdAt,
    expiresAt: approval.expiresAt,
    approvedAt: approval.approvedAt,
    submittedAt: approval.submittedAt,
    confirmedAt: approval.confirmedAt,
    summary: approval.summary,
  };
}
