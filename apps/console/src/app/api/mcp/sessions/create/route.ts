/**
 * MCP Session — Create.
 *
 * POST /api/mcp/sessions/create
 * Auth: wallet session cookie (owner must be logged in).
 * Body: { agentAccountAddress (required), permissions?, expiresInDays? }
 *
 * Creates a new MCP session for the authenticated wallet owner.
 * Upserts the agent account binding (owner → Circle Smart Account).
 * Returns the raw token ONCE — caller must save it.
 *
 * PR 451 constraints:
 * - autoApprove is hardcoded false (approval engine in PR 452).
 * - expiresInDays: default 30, max 30. No arbitrary expiresInMs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAddress, getAddress } from 'viem';
import { authenticateWalletRequest } from '@/lib/mcp/session-auth';
import { upsertAgentAccountForOwner } from '@/lib/agent-accounts/store';
import { createMcpSession } from '@/lib/agent-accounts/store';
import type { McpSessionPermissions } from '@/lib/agent-accounts/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_EXPIRY_DAYS = 30;
const DEFAULT_EXPIRY_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DEFAULT_PERMISSIONS: McpSessionPermissions = {
  allowedContracts: ['ERC8004_IDENTITY_REGISTRY'],
  allowedActions: ['identity.register'],
};

export async function POST(req: NextRequest) {
  if (process.env.MCP_AGENT_ACCOUNT_IDENTITY_ENABLED !== 'true') {
    return NextResponse.json(
      { ok: false, error: 'agent_account_mcp_disabled', detail: 'Agent Account MCP identity mode is temporarily disabled. Use EOA registration.' },
      { status: 403 },
    );
  }

  // 1. Authenticate wallet session
  const auth = await authenticateWalletRequest(req);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  // 2. Parse body
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json', detail: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }

  // 3. Validate agentAccountAddress (required)
  const rawAddress = typeof body.agentAccountAddress === 'string'
    ? body.agentAccountAddress.trim()
    : '';
  if (!rawAddress || !isAddress(rawAddress)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_agent_account_address', detail: 'Valid EVM address required in agentAccountAddress.' },
      { status: 400 },
    );
  }
  const agentAccountAddress = getAddress(rawAddress);

  // 4. Force autoApprove=false (PR 451 — approval engine doesn't exist yet)
  if (body.autoApprove === true) {
    return NextResponse.json(
      { ok: false, error: 'auto_approve_disabled', detail: 'autoApprove=true is not supported until the approval engine ships (PR 452).' },
      { status: 400 },
    );
  }

  // 5. Clamp expiry: default 30 days, max 30 days
  const requestedDays = typeof body.expiresInDays === 'number' ? body.expiresInDays : DEFAULT_EXPIRY_DAYS;
  const clampedDays = Math.max(1, Math.min(MAX_EXPIRY_DAYS, Math.floor(requestedDays)));
  const expiresInMs = clampedDays * MS_PER_DAY;

  // 6. Parse permissions — empty/missing → DEFAULT_PERMISSIONS
  const rawPerms = typeof body.permissions === 'object' && body.permissions !== null
    ? body.permissions as McpSessionPermissions
    : undefined;

  const hasContracts = Array.isArray(rawPerms?.allowedContracts) && rawPerms!.allowedContracts!.length > 0;
  const hasActions = Array.isArray(rawPerms?.allowedActions) && rawPerms!.allowedActions!.length > 0;
  const permissions: McpSessionPermissions = (hasContracts && hasActions)
    ? rawPerms!
    : DEFAULT_PERMISSIONS;

  // 7. Upsert agent account binding + create session
  try {
    const ownerAddress = getAddress(auth.wallet);

    // Upsert: deactivate old binding, insert new active one
    await upsertAgentAccountForOwner({
      ownerAddress,
      agentAccountAddress,
    });

    // Create session (autoApprove forced false)
    const result = await createMcpSession({
      ownerAddress,
      agentAccountAddress,
      permissions,
      autoApprove: false,
      expiresInMs,
    });

    // 8. Return token ONCE + session metadata + Claude config
    return NextResponse.json({
      ok: true,
      token: result.token,
      session: {
        id: result.session.id,
        ownerAddress: result.session.ownerAddress,
        agentAccountAddress: result.session.agentAccountAddress,
        permissions: result.session.permissions,
        autoApprove: result.session.autoApprove,
        expiresAt: result.session.expiresAt,
        createdAt: result.session.createdAt,
      },
      claudeConfig: {
        ARCLAYER_MCP_URL: `${req.nextUrl.origin}/api/mcp`,
        ARCLAYER_MCP_TOKEN: result.token,
        MCP_TRANSPORT: 'http',
      },
      warning: 'Save this token now — it will not be shown again.',
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: 'session_create_failed', detail: message },
      { status: 500 },
    );
  }
}
