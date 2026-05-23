/**
 * A2A Receipt — generates provider-signed receipts for every signal purchase.
 * Receipt = cryptographic proof that Pythia served signal X to buyer Y at time T.
 * Can be anchored on-chain via A2AReceiptRegistry.
 */
import { keccak256, toBytes, encodePacked, type Address, type Hash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Rail } from '../contracts/a2a-client.js';

export interface A2AReceipt {
  providerAgentId: `0x${string}`;
  buyerAgentId: `0x${string}`;
  receiptHash: `0x${string}`;
  requestHash: `0x${string}`;
  responseHash: `0x${string}`;
  signalHash: `0x${string}`;
  amount: bigint;
  timestamp: bigint;
  rail: Rail;
  paymentRef: `0x${string}`;
  tradeTx: `0x${string}`;
  provider: Address;
  exists: boolean;
  providerSig: `0x${string}`;
}

export interface SignalPayload {
  token: string;
  signal: string;
  confidence: number;
  price: number;
  timestamp: number;
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

export function hashSignal(signal: SignalPayload): `0x${string}` {
  return keccak256(
    toBytes(JSON.stringify({ token: signal.token, signal: signal.signal, confidence: signal.confidence, price: signal.price, ts: signal.timestamp }))
  );
}

export function hashRequest(token: string, buyer: Address, ts: number): `0x${string}` {
  return keccak256(encodePacked(['string', 'address', 'uint256'], [token, buyer, BigInt(ts)]));
}

export function hashResponse(signalHash: `0x${string}`, paymentRef: `0x${string}`): `0x${string}` {
  return keccak256(encodePacked(['bytes32', 'bytes32'], [signalHash, paymentRef]));
}

export function computeReceiptHash(
  providerAgentId: `0x${string}`,
  buyerAgentId: `0x${string}`,
  requestHash: `0x${string}`,
  responseHash: `0x${string}`,
  amount: bigint,
  timestamp: bigint,
): `0x${string}` {
  return keccak256(
    encodePacked(
      ['bytes32', 'bytes32', 'bytes32', 'bytes32', 'uint128', 'uint64'],
      [providerAgentId, buyerAgentId, requestHash, responseHash, amount, timestamp],
    )
  );
}

export async function createSignedReceipt(
  providerPrivateKey: `0x${string}`,
  providerAgentId: `0x${string}`,
  buyerAgentId: `0x${string}`,
  signal: SignalPayload,
  buyerAddress: Address,
  amount: bigint,
  paymentRef: `0x${string}`,
  tradeTx: `0x${string}` = ZERO_BYTES32,
  rail: Rail = Rail.ARC_NATIVE,
): Promise<A2AReceipt> {
  const account = privateKeyToAccount(providerPrivateKey);
  const ts = BigInt(Math.floor(Date.now() / 1000));

  const signalH = hashSignal(signal);
  const requestH = hashRequest(signal.token, buyerAddress, signal.timestamp);
  const responseH = hashResponse(signalH, paymentRef);
  const receiptH = computeReceiptHash(providerAgentId, buyerAgentId, requestH, responseH, amount, ts);

  // Provider signs the same EIP-712 struct verified by A2AReceiptRegistry.
  const providerSig = await account.signTypedData({
    domain: {
      name: 'ArcLayerA2AReceipt',
      version: '1',
      chainId: 5042002,
      verifyingContract: process.env.A2A_RECEIPT_REGISTRY_ADDRESS as `0x${string}` | undefined,
    },
    types: {
      Receipt: [
        { name: 'providerAgentId', type: 'bytes32' },
        { name: 'buyerAgentId', type: 'bytes32' },
        { name: 'amount', type: 'uint128' },
        { name: 'paymentRef', type: 'bytes32' },
        { name: 'requestHash', type: 'bytes32' },
        { name: 'responseHash', type: 'bytes32' },
        { name: 'signalHash', type: 'bytes32' },
        { name: 'timestamp', type: 'uint64' },
      ],
    },
    primaryType: 'Receipt',
    message: {
      providerAgentId,
      buyerAgentId,
      amount,
      paymentRef,
      requestHash: requestH,
      responseHash: responseH,
      signalHash: signalH,
      timestamp: ts,
    },
  });

  return {
    providerAgentId,
    buyerAgentId,
    receiptHash: receiptH,
    requestHash: requestH,
    responseHash: responseH,
    signalHash: signalH,
    amount,
    timestamp: ts,
    rail,
    paymentRef,
    tradeTx,
    provider: account.address,
    exists: true,
    providerSig: providerSig as `0x${string}`,
  };
}
