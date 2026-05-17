/**
 * Arc Native settlement — self-hosted transferWithAuthorization ONLY.
 *
 * STRICT RAIL RULE:
 *   This module NEVER calls Circle Gateway REST, BatchFacilitatorClient, or any
 *   Circle API. Gateway settlement lives exclusively in the middleware's
 *   `handleGateway()` path.
 *
 * IDEMPOTENCY:
 *   Uses atomic reserve-before-submit via `x402_native_claim_payment` RPC.
 *   Before calling transferWithAuthorization, we atomically reserve the
 *   paymentIdentifier as "pending" (settling). If already pending or settled,
 *   we return immediately without submitting a second transaction.
 *
 * LOST-SUCCESS RECOVERY:
 *   If transferWithAuthorization reverts with "authorization_used" / "nonce
 *   already used", we verify the settlement proof on-chain. If the proof
 *   matches (payer, payTo, asset, amount, nonce), we backfill the ledger and
 *   return success=true, alreadySettled=true. The user never sees a failure.
 */
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseGwei,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ARC_TESTNET_CAIP2_NETWORK, ARC_TESTNET_CHAIN_ID, USDC_ADDRESS } from '../constants';
import type { PaymentPayload, PaymentRequirements, SettleErrorReason, SettleResponse } from './types';
import {
  backfillNativeSettled,
  claimNativePayment,
  deriveNativePaymentId,
  markNativeFailed,
  markNativeSettled,
} from './native-payment-store';
import { verifyExactSettlementProof } from './verify-settlement-proof';

const TRANSFER_WITH_AUTHORIZATION_ABI = [
  {
    name: 'transferWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

export interface SettleExactInput {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  /** If true, skip Circle Gateway and settle directly on-chain. (Legacy compat — always true now.) */
  selfHosted?: boolean;
  rpcUrl?: string;
  /** Relayer private key (hex). Required for self-hosted settlement. */
  relayerPrivateKey?: Hex;
}

function settleErr(reason: SettleErrorReason, message: string): SettleResponse {
  return {
    success: false,
    errorReason: reason,
    errorMessage: message,
    transaction: '',
    network: ARC_TESTNET_CAIP2_NETWORK,
  };
}

function splitSignature(sig: Hex): { v: number; r: Hex; s: Hex } {
  const raw = sig.slice(2);
  const r = `0x${raw.slice(0, 64)}` as Hex;
  const s = `0x${raw.slice(64, 128)}` as Hex;
  let v = parseInt(raw.slice(128, 130), 16);
  if (v < 27) v += 27;
  return { v, r, s };
}

/**
 * Self-hosted settlement: submit transferWithAuthorization on-chain via relayer wallet.
 * Relayer must hold USDC for gas on Arc (USDC is the gas token).
 *
 * Atomic reserve-before-submit:
 *   1. Derive paymentIdentifier from (network, asset, from, nonce).
 *   2. Atomically claim the slot as "pending" via Supabase RPC.
 *   3. If already settled → return alreadySettled with existing txHash.
 *   4. If already pending (in-flight) → return settlement_in_progress.
 *   5. If previous_failed → retry is allowed (claim returns acquired=true for failed).
 *   6. Submit transferWithAuthorization.
 *   7. On success → markNativeSettled.
 *   8. On authorization_used → verify on-chain proof → backfill → return alreadySettled.
 *   9. On other failure → markNativeFailed.
 */
async function settleOnChain(input: SettleExactInput): Promise<SettleResponse> {
  const relayerKey = input.relayerPrivateKey ?? (process.env.X402_RELAYER_PRIVATE_KEY as Hex | undefined);
  if (!relayerKey) {
    return settleErr('relayer_not_configured', 'No relayer private key configured for self-hosted settlement');
  }

  const rpcUrl = input.rpcUrl ?? process.env.ARC_RPC_URL ?? 'https://rpc.drpc.testnet.arc.network';
  const auth = input.paymentPayload.payload.authorization;
  const { v, r, s } = splitSignature(input.paymentPayload.payload.signature);
  const asset = getAddress(input.paymentRequirements.asset) as Address;
  const from = getAddress(auth.from) as Address;
  const to = getAddress(auth.to) as Address;

  // ─── Step 1: Derive paymentIdentifier ───────────────────────────────────────
  const paymentIdentifier = deriveNativePaymentId({
    network: input.paymentRequirements.network,
    asset,
    from,
    nonce: auth.nonce,
  });

  // ─── Step 2: Atomic reserve-before-submit ───────────────────────────────────
  const claimed = await claimNativePayment({
    network: input.paymentRequirements.network,
    asset,
    from,
    nonce: auth.nonce,
    payTo: to,
    amount: auth.value,
  });

  // ─── Step 3: Already settled → return immediately ───────────────────────────
  if (!claimed.acquired && claimed.reason === 'already_settled') {
    return {
      success: true,
      alreadySettled: true,
      payer: getAddress(claimed.existing.payer ?? from) as Address,
      transaction: claimed.existing.txHash ?? '',
      network: ARC_TESTNET_CAIP2_NETWORK,
      amount: claimed.existing.amount ?? input.paymentRequirements.amount,
      paymentIdentifier,
    };
  }

  // ─── Step 4: In-flight → return settlement_in_progress ─────────────────────
  if (!claimed.acquired && claimed.reason === 'in_flight') {
    return {
      success: false,
      errorReason: 'duplicate',
      errorMessage: 'This Arc Native payment is already being settled by another request. Retry shortly.',
      transaction: '',
      network: ARC_TESTNET_CAIP2_NETWORK,
      amount: claimed.existing.amount ?? input.paymentRequirements.amount,
      paymentIdentifier,
    };
  }

  // claimed.acquired === true (fresh or previous_failed retry)
  const account = privateKeyToAccount(relayerKey);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  });

  try {
    // Check relayer has gas (USDC is gas on Arc)
    const relayerBalance = await publicClient.readContract({
      address: asset,
      abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
      functionName: 'balanceOf',
      args: [account.address],
    });

    // Need at least some gas — 0.01 USDC (10000 atomic units) as minimum
    if (relayerBalance < BigInt(10000)) {
      await markNativeFailed({ paymentId: paymentIdentifier, errorReason: 'relayer_unfunded', errorMessage: 'Relayer wallet has insufficient USDC for gas' }).catch(() => undefined);
      return { ...settleErr('relayer_unfunded', 'Relayer wallet has insufficient USDC for gas'), paymentIdentifier };
    }

    // ─── Step 6: Submit transferWithAuthorization ──────────────────────────────
    const hash = await walletClient.writeContract({
      address: asset,
      abi: TRANSFER_WITH_AUTHORIZATION_ABI,
      functionName: 'transferWithAuthorization',
      args: [
        from,
        to,
        BigInt(auth.value),
        BigInt(auth.validAfter),
        BigInt(auth.validBefore),
        auth.nonce,
        v,
        r as Hex,
        s as Hex,
      ],
      maxFeePerGas: parseGwei('25'),
      maxPriorityFeePerGas: parseGwei('2'),
      chain: {
        id: ARC_TESTNET_CHAIN_ID,
        name: 'Arc Testnet',
        nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      },
    });

    // Wait for receipt (Arc has sub-second finality)
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 10_000,
    });

    if (receipt.status === 'reverted') {
      await markNativeFailed({ paymentId: paymentIdentifier, errorReason: 'tx_reverted', errorMessage: `Transaction reverted: ${hash}` }).catch(() => undefined);
      return { ...settleErr('tx_reverted', `Transaction reverted: ${hash}`), paymentIdentifier };
    }

    // ─── Step 7: Mark settled ─────────────────────────────────────────────────
    await markNativeSettled({ paymentId: paymentIdentifier, txHash: hash, payTo: to, amount: auth.value });

    return {
      success: true,
      payer: from,
      transaction: hash,
      network: ARC_TESTNET_CAIP2_NETWORK,
      amount: input.paymentRequirements.amount,
      paymentIdentifier,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    // ─── Step 8: Lost-success recovery ──────────────────────────────────────────
    if (msg.includes('nonce') || msg.includes('already used') || msg.includes('AuthorizationUsed')) {
      const proof = await verifyExactSettlementProof({
        paymentPayload: input.paymentPayload,
        paymentRequirements: input.paymentRequirements,
        rpcUrl,
      }).catch(() => null);

      if (proof?.ok) {
        // On-chain confirms this nonce was used with matching payer/payTo/asset/amount.
        // Backfill the ledger and return success.
        await backfillNativeSettled({
          identity: {
            network: input.paymentRequirements.network,
            asset,
            from,
            nonce: auth.nonce,
            payTo: to,
            amount: auth.value,
          },
          txHash: proof.txHash,
        });
        return {
          success: true,
          alreadySettled: true,
          payer: from,
          transaction: proof.txHash ?? '',
          network: ARC_TESTNET_CAIP2_NETWORK,
          amount: input.paymentRequirements.amount,
          paymentIdentifier,
        };
      }

      // Proof failed — nonce used but doesn't match our requirements. Genuine failure.
      await markNativeFailed({ paymentId: paymentIdentifier, errorReason: 'authorization_used', errorMessage: 'EIP-3009 authorization nonce already consumed' }).catch(() => undefined);
      return { ...settleErr('authorization_used', 'EIP-3009 authorization nonce already consumed'), paymentIdentifier };
    }

    // ─── Step 9: Other failures ─────────────────────────────────────────────────
    if (msg.includes('insufficient') || msg.includes('balance')) {
      await markNativeFailed({ paymentId: paymentIdentifier, errorReason: 'insufficient_balance', errorMessage: 'Payer has insufficient balance at settlement time' }).catch(() => undefined);
      return { ...settleErr('insufficient_balance', 'Payer has insufficient balance at settlement time'), paymentIdentifier };
    }

    await markNativeFailed({ paymentId: paymentIdentifier, errorReason: 'rpc_failure', errorMessage: msg.slice(0, 300) }).catch(() => undefined);
    return { ...settleErr('rpc_failure', msg.slice(0, 300)), paymentIdentifier };
  }
}

/**
 * Main Arc Native settle entry point.
 *
 * Strict rail rule:
 *   This function is self-hosted Arc Native ONLY. It never calls Circle Gateway
 *   REST and never uses BatchFacilitatorClient. Gateway settlement lives only in
 *   the middleware's `handleGateway()` path.
 */
export async function settleExactPayment(input: SettleExactInput): Promise<SettleResponse> {
  // Check authorization hasn't expired
  const now = Math.floor(Date.now() / 1000);
  const validBefore = Number(input.paymentPayload.payload.authorization.validBefore);
  if (now > validBefore) {
    return settleErr('authorization_expired', 'EIP-3009 authorization has expired');
  }

  return settleOnChain(input);
}
