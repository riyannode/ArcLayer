/**
 * POST /api/profile/agent-wallet-bindings
 *
 * Persists agent_id → agent_account_address binding after ERC-8004 mint.
 * Auth: wallet session cookie (owner address derived server-side).
 * Does NOT write agent_x402_payers.
 */

import { NextRequest } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { humanJson } from '@/lib/api/human-json';
import {
  SESSION_COOKIE_NAME,
  resolveSessionFromCookie,
} from '@/lib/auth/wallet-session';
import { getActiveAgentAccountForOwner } from '@/lib/agent-accounts/store';
import { isAgentAccountServerRailEnabled } from '@/lib/agent-accounts/feature-flags';
import {
  getActiveAgentWalletBindingsForOwner,
  upsertActiveAgentWalletBinding,
} from '@/lib/agent-wallet-bindings/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Auth helper ────────────────────────────────────────────────────────

async function getWallet(req: NextRequest): Promise<string | null> {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) return null;
  const session = await resolveSessionFromCookie(cookieValue);
  return session?.wallet ?? null;
}

// ── Validation helpers ─────────────────────────────────────────────────

function isTxHash(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

// ── GET ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAgentAccountServerRailEnabled()) {
    return humanJson(
      req,
      { ok: true, disabled: true, bindings: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const wallet = await getWallet(req);
  if (!wallet) {
    return humanJson(req, { ok: false, error: 'not_authenticated' }, { status: 401 });
  }

  const bindings = await getActiveAgentWalletBindingsForOwner(wallet);

  return humanJson(
    req,
    {
      ok: true,
      ownerAddress: getAddress(wallet),
      bindings,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// ── POST ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAgentAccountServerRailEnabled()) {
    return humanJson(
      req,
      {
        ok: false,
        error: 'agent_account_disabled',
        detail: 'Agent Wallet rail is disabled.',
      },
      { status: 403 },
    );
  }

  const wallet = await getWallet(req);
  if (!wallet) {
    return humanJson(req, { ok: false, error: 'not_authenticated' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return humanJson(req, { ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // ── Parse fields ───────────────────────────────────────────────────

  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
  const agentAccountRaw =
    typeof body.agentAccountAddress === 'string' ? body.agentAccountAddress.trim() : '';
  const controllerMode =
    body.controllerMode === 'agent-account' || body.controllerMode === 'eoa'
      ? body.controllerMode
      : 'agent-account';
  const registrationTxHash =
    typeof body.registrationTxHash === 'string' && body.registrationTxHash.trim()
      ? body.registrationTxHash.trim()
      : null;
  const metadataUri =
    typeof body.metadataURI === 'string'
      ? body.metadataURI
      : typeof body.metadataUri === 'string'
        ? body.metadataUri
        : null;
  const chainId =
    typeof body.chainId === 'number' && Number.isFinite(body.chainId)
      ? body.chainId
      : 5042002;

  // ── Validate ───────────────────────────────────────────────────────

  if (!agentId) {
    return humanJson(req, { ok: false, error: 'agent_id_required' }, { status: 400 });
  }

  if (!agentAccountRaw || !isAddress(agentAccountRaw)) {
    return humanJson(
      req,
      { ok: false, error: 'invalid_agent_wallet_address' },
      { status: 400 },
    );
  }

  if (controllerMode !== 'agent-account') {
    return humanJson(
      req,
      {
        ok: false,
        error: 'unsupported_controller_mode',
        detail: 'Only agent-account controller bindings are persisted here.',
      },
      { status: 400 },
    );
  }

  if (registrationTxHash && !isTxHash(registrationTxHash)) {
    return humanJson(
      req,
      { ok: false, error: 'invalid_registration_tx_hash' },
      { status: 400 },
    );
  }

  // ── Resolve owner + verify active Agent Wallet ─────────────────────

  const ownerAddress = getAddress(wallet);
  const submittedAgentAccount = getAddress(agentAccountRaw);

  const activeAgentAccount = await getActiveAgentAccountForOwner(ownerAddress);
  if (!activeAgentAccount?.agentAccountAddress) {
    return humanJson(
      req,
      {
        ok: false,
        error: 'agent_wallet_not_found',
        detail: 'Create or link an active Circle Agent Wallet first.',
      },
      { status: 409 },
    );
  }

  if (
    activeAgentAccount.agentAccountAddress.toLowerCase() !==
    submittedAgentAccount.toLowerCase()
  ) {
    return humanJson(
      req,
      {
        ok: false,
        error: 'agent_wallet_mismatch',
        detail:
          'Submitted Agent Wallet does not match the active Agent Wallet for this owner.',
      },
      { status: 403 },
    );
  }

  // ── Upsert binding ─────────────────────────────────────────────────

  try {
    const binding = await upsertActiveAgentWalletBinding({
      ownerAddress,
      agentId,
      agentAccountAddress: submittedAgentAccount,
      controllerMode,
      chainId,
      registrationTxHash,
      metadataUri,
    });

    return humanJson(
      req,
      { ok: true, binding },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('agent_already_bound_to_different_owner')) {
      return humanJson(
        req,
        {
          ok: false,
          error: 'agent_already_bound_to_different_owner',
          detail:
            'This ERC-8004 Agent ID already has an active Agent Wallet binding for another owner.',
        },
        { status: 409 },
      );
    }

    return humanJson(
      req,
      {
        ok: false,
        error: 'binding_failed',
        detail: message,
      },
      { status: 500 },
    );
  }
}
