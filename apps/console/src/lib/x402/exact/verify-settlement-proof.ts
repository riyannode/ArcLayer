/**
 * Verify a settled x402 exact payment as proof to unlock a protected resource.
 *
 * Difference from verifyExactEvmPayment:
 *   - Pre-settlement verify REQUIRES nonce NOT used (settle would fail otherwise).
 *   - Post-settlement proof REQUIRES nonce IS used (proves transferWithAuthorization happened).
 *
 * Both verify the EIP-712 signature and that the recipient/asset/amount match
 * the resource's paymentRequirements. The signature plus the on-chain nonce-used
 * state is a self-contained proof that the buyer paid the seller for this resource.
 */
import {
  createPublicClient,
  getAddress,
  http,
  parseAbiItem,
  verifyTypedData,
  type Address,
  type Hex,
} from 'viem';
import { ARC_TESTNET_CHAIN_ID, USDC_ADDRESS } from '../constants';
import { exactEip3009Abi } from './verify-exact';
import type { InvalidReason, PaymentPayload, PaymentRequirements } from './types';

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

const AUTHORIZATION_USED_EVENT = parseAbiItem('event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)');

export interface SettlementProofResult {
  ok: boolean;
  reason?: InvalidReason | 'not_settled' | 'mismatched_resource';
  message?: string;
  payer?: Address;
  txHash?: string;
  amount?: string;
  nonce?: Hex;
  asset?: Address;
}

export interface VerifySettlementProofInput {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  rpcUrl?: string;
}

/**
 * Verifies that a x402 payment payload corresponds to a real on-chain settled
 * transferWithAuthorization. Returns the tx hash if found.
 */
export async function verifyExactSettlementProof(
  input: VerifySettlementProofInput,
): Promise<SettlementProofResult> {
  const { paymentPayload, paymentRequirements } = input;
  const auth = paymentPayload.payload.authorization;
  const asset = getAddress(paymentRequirements.asset);
  const from = getAddress(auth.from);
  const to = getAddress(auth.to);

  // Resource match: payment proof's recipient/asset/amount must equal the
  // protected resource's requirements. Otherwise the proof is for a different
  // payment.
  if (to !== getAddress(paymentRequirements.payTo)) {
    return { ok: false, reason: 'invalid_recipient', message: 'Payment proof recipient does not match resource recipient' };
  }
  if (asset !== getAddress(USDC_ADDRESS)) {
    return { ok: false, reason: 'unsupported_asset', message: 'Payment proof asset is not Arc Testnet USDC' };
  }
  if (auth.value !== paymentRequirements.amount) {
    return { ok: false, reason: 'invalid_amount', message: `Payment proof amount ${auth.value} does not match required ${paymentRequirements.amount}` };
  }

  const rpcUrl = input.rpcUrl ?? process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
  const client = createPublicClient({ transport: http(rpcUrl) });

  // 1. Verify EIP-712 signature
  let name: string;
  let version: string;
  try {
    [name, version] = await Promise.all([
      client.readContract({ address: asset, abi: exactEip3009Abi, functionName: 'name' }).catch(() => String(paymentRequirements.extra?.name ?? 'USDC')) as Promise<string>,
      client.readContract({ address: asset, abi: exactEip3009Abi, functionName: 'version' }).catch(() => String(paymentRequirements.extra?.version ?? '2')) as Promise<string>,
    ]);
  } catch (err) {
    return { ok: false, reason: 'chain_unavailable', message: err instanceof Error ? err.message : String(err) };
  }

  const validSignature = await verifyTypedData({
    address: from,
    domain: { name, version, chainId: ARC_TESTNET_CHAIN_ID, verifyingContract: asset },
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
  if (!validSignature) {
    return { ok: false, reason: 'invalid_signature', message: 'EIP-3009 signature is invalid' };
  }

  // 2. Check on-chain that this authorization was actually used (= settled).
  let used: boolean;
  try {
    used = (await client.readContract({
      address: asset,
      abi: exactEip3009Abi,
      functionName: 'authorizationState',
      args: [from, auth.nonce],
    })) as boolean;
  } catch (err) {
    return { ok: false, reason: 'chain_unavailable', message: err instanceof Error ? err.message : String(err) };
  }

  if (!used) {
    return {
      ok: false,
      reason: 'not_settled',
      message: 'Authorization has not been settled on-chain yet. Settlement happens inline during paid retry.',
    };
  }

  // 3. Find the settlement tx hash by querying AuthorizationUsed logs.
  // Best-effort lookup over recent blocks; if it fails, still return ok=true
  // (signature + on-chain used flag is sufficient cryptographic proof).
  let txHash: string | undefined;
  try {
    const head = await client.getBlockNumber();
    const fromBlock = head > BigInt(20000) ? head - BigInt(20000) : BigInt(0);
    const logs = await client.getLogs({
      address: asset,
      event: AUTHORIZATION_USED_EVENT,
      args: { authorizer: from, nonce: auth.nonce },
      fromBlock,
      toBlock: head,
    });
    if (logs.length > 0) {
      txHash = logs[logs.length - 1]?.transactionHash ?? undefined;
    }
  } catch {
    // Non-fatal — proof still valid without explicit tx hash.
  }

  return {
    ok: true,
    payer: from,
    txHash,
    amount: auth.value,
    nonce: auth.nonce,
    asset,
  };
}
