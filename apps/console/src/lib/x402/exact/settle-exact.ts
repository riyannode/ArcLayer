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
  /** If true, skip Circle Gateway and settle directly on-chain. */
  selfHosted?: boolean;
  rpcUrl?: string;
  /** Relayer private key (hex). Required for self-hosted settlement. */
  relayerPrivateKey?: Hex;
  /** Circle Gateway base URL. */
  circleGatewayUrl?: string;
  /** Circle API key for gateway auth. */
  circleApiKey?: string;
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
 * Attempt settlement via Circle Gateway (testnet or mainnet).
 * Falls back to self-hosted if gateway is unavailable or returns error.
 */
async function settleViaCircleGateway(input: SettleExactInput): Promise<SettleResponse> {
  const baseUrl = input.circleGatewayUrl ?? process.env.CIRCLE_GATEWAY_URL ?? 'https://gateway-api-testnet.circle.com';
  const apiKey = input.circleApiKey ?? process.env.CIRCLE_API_KEY ?? '';

  if (!apiKey) {
    // No Circle API key configured — fall through to self-hosted
    return settleErr('relayer_not_configured', 'Circle Gateway API key not configured, falling back to self-hosted');
  }

  const body = {
    paymentPayload: {
      x402Version: input.paymentPayload.x402Version,
      accepted: input.paymentPayload.accepted,
      payload: input.paymentPayload.payload,
      extensions: input.paymentPayload.extensions,
    },
    paymentRequirements: input.paymentRequirements,
  };

  try {
    const resp = await fetch(`${baseUrl}/v1/x402/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      // If Circle returns 4xx/5xx, we can try self-hosted fallback
      return settleErr('rpc_failure', `Circle Gateway returned ${resp.status}: ${text.slice(0, 200)}`);
    }

    const result = (await resp.json()) as Record<string, unknown>;
    if (result.success === true || result.transaction) {
      return {
        success: true,
        payer: getAddress(input.paymentPayload.payload.authorization.from),
        transaction: String(result.transaction ?? ''),
        network: ARC_TESTNET_CAIP2_NETWORK,
        amount: input.paymentRequirements.amount,
        paymentIdentifier: String(result.paymentIdentifier ?? ''),
      };
    }

    // Gateway returned success=false
    return settleErr(
      (result.errorReason as SettleErrorReason) ?? 'unexpected_error',
      String(result.errorMessage ?? 'Circle Gateway settlement failed'),
    );
  } catch (error) {
    return settleErr('rpc_failure', `Circle Gateway unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Self-hosted settlement: submit transferWithAuthorization on-chain via relayer wallet.
 * Relayer must hold USDC for gas on Arc (USDC is the gas token).
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
      return settleErr('relayer_unfunded', 'Relayer wallet has insufficient USDC for gas');
    }

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
      return settleErr('tx_reverted', `Transaction reverted: ${hash}`);
    }

    return {
      success: true,
      payer: from,
      transaction: hash,
      network: ARC_TESTNET_CAIP2_NETWORK,
      amount: input.paymentRequirements.amount,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('nonce') || msg.includes('already used')) {
      return settleErr('authorization_used', 'EIP-3009 authorization nonce already consumed');
    }
    if (msg.includes('insufficient') || msg.includes('balance')) {
      return settleErr('insufficient_balance', 'Payer has insufficient balance at settlement time');
    }
    return settleErr('rpc_failure', msg.slice(0, 300));
  }
}

/**
 * Main settle entry point.
 * Strategy: Circle Gateway first → self-hosted fallback if gateway fails.
 * If `selfHosted: true`, skip gateway entirely.
 */
export async function settleExactPayment(input: SettleExactInput): Promise<SettleResponse> {
  // Check authorization hasn't expired
  const now = Math.floor(Date.now() / 1000);
  const validBefore = Number(input.paymentPayload.payload.authorization.validBefore);
  if (now > validBefore) {
    return settleErr('authorization_expired', 'EIP-3009 authorization has expired');
  }

  if (input.selfHosted) {
    return settleOnChain(input);
  }

  // Try Circle Gateway first
  const gatewayResult = await settleViaCircleGateway(input);
  if (gatewayResult.success) return gatewayResult;

  // Fallback to self-hosted if gateway failed with recoverable error
  const recoverableReasons: SettleErrorReason[] = ['rpc_failure', 'relayer_not_configured'];
  if (recoverableReasons.includes(gatewayResult.errorReason as SettleErrorReason)) {
    const onChainResult = await settleOnChain(input);
    if (onChainResult.success) return onChainResult;
    // If both fail, return the on-chain error (more actionable)
    return onChainResult;
  }

  return gatewayResult;
}
