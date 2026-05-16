import { createHash } from 'crypto';
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isHex,
  verifyTypedData,
  type Address,
  type Hex,
} from 'viem';
import {
  ARC_TESTNET_CAIP2_NETWORK,
  ARC_TESTNET_CHAIN_ID,
  USDC_ADDRESS,
} from '../constants';
import type { InvalidReason, PaymentPayload, PaymentRequirements, VerifyResponse } from './types';

const EIP3009_ABI = [
  {
    name: 'authorizationState',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'version',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface VerifyExactInput {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  rpcUrl?: string;
  nowSeconds?: number;
}

function err(reason: InvalidReason, message: string): VerifyResponse {
  return { isValid: false, invalidReason: reason, invalidMessage: message };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isHexBytes32(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isSignature(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{130}$/.test(value);
}

function normalizeAddress(value: unknown): Address | null {
  if (typeof value !== 'string' || !isAddress(value)) return null;
  return getAddress(value);
}

function parseAmount(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null;
  try {
    const n = BigInt(value);
    return n >= BigInt(0) ? n : null;
  } catch {
    return null;
  }
}

function paymentIdentifier(asset: Address, from: Address, nonce: Hex): string {
  return createHash('sha256')
    .update(`exact:eip3009:${ARC_TESTNET_CAIP2_NETWORK}:${asset.toLowerCase()}:${from.toLowerCase()}:${nonce.toLowerCase()}`)
    .digest('hex');
}

export function parseExactVerifyRequest(body: unknown):
  | { ok: true; paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements }
  | { ok: false; status: number; reason: InvalidReason; message: string } {
  const obj = asRecord(body);
  if (!obj) return { ok: false, status: 400, reason: 'invalid_json', message: 'Request body must be a JSON object' };
  if (obj.x402Version !== 2) return { ok: false, status: 400, reason: 'unsupported_version', message: 'x402Version 2 is required for exact scheme' };

  const paymentPayload = asRecord(obj.paymentPayload);
  const paymentRequirements = asRecord(obj.paymentRequirements);
  if (!paymentPayload || !paymentRequirements) {
    return { ok: false, status: 400, reason: 'missing_parameters', message: 'paymentPayload and paymentRequirements are required' };
  }

  const accepted = asRecord(paymentPayload.accepted);
  const payload = asRecord(paymentPayload.payload);
  const authorization = asRecord(payload?.authorization);
  if (!accepted || !payload || !authorization) {
    return { ok: false, status: 422, reason: 'invalid_payment_payload', message: 'paymentPayload.accepted, payload.signature, and payload.authorization are required' };
  }

  if (paymentPayload.x402Version !== 2) {
    return { ok: false, status: 422, reason: 'unsupported_version', message: 'paymentPayload.x402Version must be 2' };
  }
  if (paymentRequirements.scheme !== 'exact' || accepted.scheme !== 'exact') {
    return { ok: false, status: 422, reason: 'unsupported_scheme', message: 'Only exact scheme is supported by this branch' };
  }
  if (paymentRequirements.network !== ARC_TESTNET_CAIP2_NETWORK || accepted.network !== ARC_TESTNET_CAIP2_NETWORK) {
    return { ok: false, status: 422, reason: 'unsupported_network', message: `Only ${ARC_TESTNET_CAIP2_NETWORK} is supported` };
  }

  const asset = normalizeAddress(paymentRequirements.asset);
  const acceptedAsset = normalizeAddress(accepted.asset);
  const payTo = normalizeAddress(paymentRequirements.payTo);
  const acceptedPayTo = normalizeAddress(accepted.payTo);
  const from = normalizeAddress(authorization.from);
  const to = normalizeAddress(authorization.to);
  if (!asset || !acceptedAsset || !payTo || !acceptedPayTo || !from || !to) {
    return { ok: false, status: 422, reason: 'invalid_payment_requirements', message: 'Invalid address in paymentRequirements or authorization' };
  }

  const arcUsdc = getAddress(USDC_ADDRESS);
  if (asset !== arcUsdc || acceptedAsset !== arcUsdc) {
    return { ok: false, status: 422, reason: 'unsupported_asset', message: 'Only Arc Testnet USDC is supported' };
  }
  if (payTo !== acceptedPayTo || payTo !== to) {
    return { ok: false, status: 422, reason: 'invalid_recipient', message: 'paymentRequirements.payTo, accepted.payTo, and authorization.to must match' };
  }

  const amount = parseAmount(paymentRequirements.amount);
  const acceptedAmount = parseAmount(accepted.amount);
  const value = parseAmount(authorization.value);
  if (amount === null || acceptedAmount === null || value === null || amount <= BigInt(0) || amount !== acceptedAmount || amount !== value) {
    return { ok: false, status: 422, reason: 'invalid_amount', message: 'paymentRequirements.amount, accepted.amount, and authorization.value must match and be positive' };
  }

  const validAfter = parseAmount(authorization.validAfter);
  const validBefore = parseAmount(authorization.validBefore);
  if (validAfter === null || validBefore === null || validBefore <= validAfter) {
    return { ok: false, status: 422, reason: 'invalid_payment_payload', message: 'Invalid validAfter/validBefore authorization window' };
  }
  if (!isHexBytes32(authorization.nonce) || !isSignature(payload.signature) || !isHex(payload.signature)) {
    return { ok: false, status: 422, reason: 'invalid_payment_payload', message: 'Invalid nonce or signature encoding' };
  }

  return {
    ok: true,
    paymentPayload: {
      x402Version: 2,
      accepted: {
        scheme: 'exact',
        network: ARC_TESTNET_CAIP2_NETWORK,
        asset,
        amount: amount.toString(),
        payTo,
        maxTimeoutSeconds: Number(paymentRequirements.maxTimeoutSeconds || accepted.maxTimeoutSeconds || 300),
        extra: asRecord(paymentRequirements.extra) ?? {},
      },
      payload: {
        signature: payload.signature as Hex,
        authorization: {
          from,
          to,
          value: value.toString(),
          validAfter: validAfter.toString(),
          validBefore: validBefore.toString(),
          nonce: authorization.nonce,
        },
      },
      resource: asRecord(paymentPayload.resource) as PaymentPayload['resource'],
      extensions: asRecord(paymentPayload.extensions) ?? undefined,
    },
    paymentRequirements: {
      scheme: 'exact',
      network: ARC_TESTNET_CAIP2_NETWORK,
      asset,
      amount: amount.toString(),
      payTo,
      maxTimeoutSeconds: Number(paymentRequirements.maxTimeoutSeconds || 300),
      extra: asRecord(paymentRequirements.extra) ?? {},
    },
  };
}

export async function verifyExactEvmPayment(input: VerifyExactInput): Promise<VerifyResponse> {
  const { paymentPayload, paymentRequirements } = input;
  const auth = paymentPayload.payload.authorization;
  const asset = getAddress(paymentRequirements.asset);
  const from = getAddress(auth.from);
  const to = getAddress(auth.to);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const validAfter = Number(auth.validAfter);
  const validBefore = Number(auth.validBefore);

  if (now < validAfter) return err('not_yet_valid', 'Authorization is not yet valid');
  if (now > validBefore) return err('expired', 'Authorization has expired');

  const client = createPublicClient({ transport: http(input.rpcUrl ?? process.env.ARC_RPC_URL ?? 'https://rpc.drpc.testnet.arc.network') });

  try {
    const [name, version, used, balance] = await Promise.all([
      client.readContract({ address: asset, abi: EIP3009_ABI, functionName: 'name' }).catch(() => String(paymentRequirements.extra.name ?? 'USD Coin')),
      client.readContract({ address: asset, abi: EIP3009_ABI, functionName: 'version' }).catch(() => String(paymentRequirements.extra.version ?? '2')),
      client.readContract({ address: asset, abi: EIP3009_ABI, functionName: 'authorizationState', args: [from, auth.nonce] }),
      client.readContract({ address: asset, abi: EIP3009_ABI, functionName: 'balanceOf', args: [from] }),
    ]);

    if (used) return err('nonce_used', 'Authorization nonce has already been used');
    if (balance < BigInt(paymentRequirements.amount)) return err('insufficient_balance', 'Payer has insufficient USDC balance');

    const validSignature = await verifyTypedData({
      address: from,
      domain: {
        name: String(name),
        version: String(version),
        chainId: ARC_TESTNET_CHAIN_ID,
        verifyingContract: asset,
      },
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: {
        from,
        to,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce,
      },
      signature: paymentPayload.payload.signature,
    });

    if (!validSignature) return err('invalid_signature', 'EIP-3009 signature is invalid');

    return {
      isValid: true,
      payer: from,
      paymentIdentifier: paymentIdentifier(asset, from, auth.nonce),
      extra: {
        transferMethod: 'eip3009',
        asset,
        payTo: to,
        amount: paymentRequirements.amount,
        validBefore: auth.validBefore,
      },
    };
  } catch (error) {
    return err('chain_unavailable', error instanceof Error ? error.message : String(error));
  }
}

export const exactEip3009Abi = EIP3009_ABI;
