/**
 * POST /api/profile/agent-wallet-bindings
 *
 * Persists agent_id → agent_account_address binding after ERC-8004 mint.
 * Auth: wallet session cookie (owner address derived server-side).
 * Does NOT write agent_x402_payers.
 *
 * Verification chain:
 * 1. Mint proof (receipt + ownerOf)
 * 2. Active Agent Account check (arclayer_agent_accounts)
 * 3. EIP-1271 Agent Wallet control signature
 * 4. Current ERC-8004 ownerOf check (supports rebind after transfer)
 */

import { NextRequest } from 'next/server';
import { createPublicClient, getAddress, http, isAddress, type Address } from 'viem';
import { CONTRACTS } from '@arclayer/sdk';
import { humanJson } from '@/lib/api/human-json';
import {
  SESSION_COOKIE_NAME,
  resolveSessionFromCookie,
} from '@/lib/auth/wallet-session';
import { getActiveAgentAccountForOwnerAndAddress } from '@/lib/agent-accounts/store';
import { isAgentAccountServerRailEnabled } from '@/lib/agent-accounts/feature-flags';
import {
  getActiveAgentWalletBindingsForOwner,
  upsertActiveAgentWalletBinding,
} from '@/lib/agent-wallet-bindings/store';
import {
  buildAgentWalletBindingMessage,
  isFreshBindingChallenge,
  verifyAgentWalletControlSignature,
} from '@/lib/agent-wallet-bindings/control-proof';
import { extractERC8004MintedTokenIdFromReceipt } from '@/lib/contracts/erc8004';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Constants ────────────────────────────────────────────────────────

const ARC_CHAIN_ID = 5042002;
const ARC_RPC_URL =
  process.env.ARC_RPC_URL ||
  process.env.NEXT_PUBLIC_ARC_RPC_URL ||
  'https://rpc.drpc.testnet.arc.network';

const OWNER_OF_ABI = [
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
] as const;

const publicClient = createPublicClient({
  transport: http(ARC_RPC_URL),
});

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

function isDecimalTokenId(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

// ── On-chain mint proof verification ──────────────────────────────────

async function verifyAgentWalletMintProof(input: {
  agentId: string;
  registrationTxHash: `0x${string}`;
  expectedOwner: Address;
}) {
  if (!isDecimalTokenId(input.agentId)) {
    return {
      ok: false as const,
      error: 'invalid_agent_id',
      detail: 'Agent ID must be a decimal ERC-8004 token ID.',
    };
  }

  const receipt = await publicClient.getTransactionReceipt({
    hash: input.registrationTxHash,
  });

  if (receipt.status !== 'success') {
    return {
      ok: false as const,
      error: 'registration_tx_failed',
      detail: 'Registration transaction was not successful.',
    };
  }

  const minted = extractERC8004MintedTokenIdFromReceipt(
    receipt,
    input.expectedOwner,
  );

  if (minted.toString() !== input.agentId) {
    return {
      ok: false as const,
      error: 'agent_id_not_minted_by_tx',
      detail: 'Registration transaction does not mint the submitted Agent ID to this Agent Wallet.',
    };
  }

  const owner = await publicClient.readContract({
    address: CONTRACTS.ERC8004_IDENTITY_REGISTRY as Address,
    abi: OWNER_OF_ABI,
    functionName: 'ownerOf',
    args: [BigInt(input.agentId)],
  });

  if (getAddress(owner) !== getAddress(input.expectedOwner)) {
    return {
      ok: false as const,
      error: 'agent_owner_mismatch',
      detail: 'On-chain ERC-8004 owner does not match the submitted Agent Wallet.',
    };
  }

  return { ok: true as const };
}

// ── Current owner check (supports rebind after transfer) ──────────────

async function verifyCurrentERC8004Owner(input: {
  agentId: string;
  expectedOwner: Address;
}) {
  if (!isDecimalTokenId(input.agentId)) {
    return {
      ok: false as const,
      error: 'invalid_agent_id',
      detail: 'Agent ID must be a decimal ERC-8004 token ID.',
    };
  }

  const owner = await publicClient.readContract({
    address: CONTRACTS.ERC8004_IDENTITY_REGISTRY as Address,
    abi: OWNER_OF_ABI,
    functionName: 'ownerOf',
    args: [BigInt(input.agentId)],
  });

  if (getAddress(owner) !== getAddress(input.expectedOwner)) {
    return {
      ok: false as const,
      error: 'agent_owner_mismatch',
      detail: 'Current on-chain ERC-8004 owner does not match the Agent Wallet.',
    };
  }

  return { ok: true as const };
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
      : ARC_CHAIN_ID;

  // ── Proof fields (Agent Wallet control signature) ──────────────────

  const agentWalletSignature =
    typeof body.agentWalletSignature === 'string' ? body.agentWalletSignature.trim() : '';

  const bindingNonce =
    typeof body.bindingNonce === 'string' ? body.bindingNonce.trim() : '';

  const bindingExpiresAt =
    typeof body.bindingExpiresAt === 'string' ? body.bindingExpiresAt.trim() : '';

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

  if (!registrationTxHash) {
    return humanJson(
      req,
      {
        ok: false,
        error: 'registration_tx_hash_required',
        detail: 'registrationTxHash is required to prove the ERC-8004 mint.',
      },
      { status: 400 },
    );
  }

  if (!isTxHash(registrationTxHash)) {
    return humanJson(
      req,
      { ok: false, error: 'invalid_registration_tx_hash' },
      { status: 400 },
    );
  }

  if (chainId !== ARC_CHAIN_ID) {
    return humanJson(
      req,
      {
        ok: false,
        error: 'unsupported_chain_id',
        detail: 'Only Arc Testnet chainId 5042002 is supported for Agent Wallet bindings.',
      },
      { status: 400 },
    );
  }

  // ── Step 1: Verify on-chain mint proof ─────────────────────────────

  const ownerAddress = getAddress(wallet);
  const submittedAgentAccount = getAddress(agentAccountRaw);

  try {
    const proof = await verifyAgentWalletMintProof({
      agentId,
      registrationTxHash: registrationTxHash as `0x${string}`,
      expectedOwner: submittedAgentAccount as Address,
    });

    if (!proof.ok) {
      return humanJson(
        req,
        {
          ok: false,
          error: proof.error,
          detail: proof.detail,
        },
        { status: 400 },
      );
    }
  } catch (error) {
    console.error('[agent-wallet-bindings] mint proof verification failed', {
      error,
      ownerAddress,
      agentId,
      registrationTxHash,
    });

    return humanJson(
      req,
      {
        ok: false,
        error: 'invalid_registration_proof',
        detail: 'Could not verify ERC-8004 mint proof for this Agent Wallet.',
      },
      { status: 400 },
    );
  }

  // ── Step 2: Verify active Agent Account ────────────────────────────
  // Rejects disabled accounts (replacement flow deactivates old accounts
  // but the binding table is not automatically updated).

  const activeAgentAccount = await getActiveAgentAccountForOwnerAndAddress(
    ownerAddress,
    submittedAgentAccount,
  );

  if (!activeAgentAccount?.agentAccountAddress) {
    return humanJson(
      req,
      {
        ok: false,
        error: 'agent_wallet_not_active',
        detail:
          'Submitted Agent Wallet is not an active verified Agent Account for this owner.',
      },
      { status: 409 },
    );
  }

  // ── Step 3: Agent Wallet control signature (EIP-1271) ──────────────

  if (!isFreshBindingChallenge({ nonce: bindingNonce, expiresAt: bindingExpiresAt })) {
    return humanJson(
      req,
      {
        ok: false,
        error: 'agent_wallet_binding_challenge_invalid',
        detail: 'Agent Wallet binding challenge is missing, expired, or invalid.',
      },
      { status: 400 },
    );
  }

  if (!agentWalletSignature) {
    return humanJson(
      req,
      {
        ok: false,
        error: 'agent_wallet_signature_required',
        detail:
          'Agent Wallet must sign the binding challenge before this ERC-8004 identity can be bound.',
      },
      { status: 400 },
    );
  }

  const bindingMessage = buildAgentWalletBindingMessage({
    ownerAddress,
    agentAccountAddress: submittedAgentAccount,
    agentId,
    registrationTxHash,
    chainId,
    nonce: bindingNonce,
    expiresAt: bindingExpiresAt,
  });

  const controlProof = await verifyAgentWalletControlSignature({
    publicClient,
    agentAccountAddress: submittedAgentAccount,
    message: bindingMessage,
    signature: agentWalletSignature,
  });

  if (!controlProof.ok) {
    return humanJson(
      req,
      {
        ok: false,
        error: controlProof.error,
        detail: controlProof.detail,
      },
      { status: 403 },
    );
  }

  // ── Step 4: Current ERC-8004 ownerOf check ─────────────────────────
  // Supports rebind after identity transfer. The mint proof checks the
  // original tx, but this checks the CURRENT on-chain state.

  const currentOwnerProof = await verifyCurrentERC8004Owner({
    agentId,
    expectedOwner: submittedAgentAccount as Address,
  });

  if (!currentOwnerProof.ok) {
    return humanJson(
      req,
      {
        ok: false,
        error: currentOwnerProof.error,
        detail: currentOwnerProof.detail,
      },
      { status: 400 },
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
      allowOwnerTransferAfterOnchainProof: true,
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

    console.error('[agent-wallet-bindings] upsert failed', {
      error,
      ownerAddress,
      agentId,
    });

    return humanJson(
      req,
      {
        ok: false,
        error: 'binding_failed',
        detail: 'Agent Wallet binding could not be saved.',
      },
      { status: 500 },
    );
  }
}
