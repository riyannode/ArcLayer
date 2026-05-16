import { describe, expect, it } from 'vitest';
import { decodePaymentHeader, encodePaymentHeader } from './headers';
import { isBatchPayment } from './gateway/batch-client';
import { deriveGatewayPaymentId } from './gateway/payment-store';
import { createArcNativeReceipt, createGatewayReceipt } from './receipt';

const ARC_NATIVE_REQUIREMENT = {
  scheme: 'exact' as const,
  network: 'eip155:5042002',
  asset: '0x3600000000000000000000000000000000000000',
  amount: '10000',
  payTo: '0x3DC78013A70d9E0d1047902f5DCB50aeF68B003b',
  maxTimeoutSeconds: 300,
  extra: { name: 'USDC', version: '2', transferMethod: 'eip3009' },
};

const CIRCLE_GATEWAY_REQUIREMENT = {
  scheme: 'exact' as const,
  network: 'arcTestnet',
  asset: '0x3600000000000000000000000000000000000000',
  amount: '10000',
  payTo: '0x3DC78013A70d9E0d1047902f5DCB50aeF68B003b',
  maxTimeoutSeconds: 300,
  extra: { name: 'GatewayWalletBatched', version: '1' },
};

const ARC_NATIVE_PAYMENT = {
  x402Version: 1,
  scheme: 'exact',
  network: 'eip155:5042002',
  payload: {
    authorization: {
      from: '0x9fC73BE13EAB35DD55547f89b1aD2663b9038eE5',
      to: '0x3DC78013A70d9E0d1047902f5DCB50aeF68B003b',
      value: '10000',
      validAfter: 0,
      validBefore: 9999999999,
      nonce: '0x1111111111111111111111111111111111111111111111111111111111111111',
    },
    signature: '0x' + '11'.repeat(65),
  },
};

const CIRCLE_GATEWAY_PAYMENT = {
  x402Version: 1,
  scheme: 'exact',
  network: 'arcTestnet',
  payload: {
    authorization: {
      from: '0x9fC73BE13EAB35DD55547f89b1aD2663b9038eE5',
      to: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
      value: '10000',
      validAfter: 0,
      validBefore: 9999999999,
      nonce: '0x2222222222222222222222222222222222222222222222222222222222222222',
    },
    signature: '0x' + '22'.repeat(65),
  },
  resource: { url: '/api/agents/1/run', description: 'ArcLayer agent run', mimeType: 'application/json' },
};

describe('hybrid x402 e2e contract', () => {
  it('routes Arc Native and Circle Gateway by requirement shape', () => {
    expect(isBatchPayment(ARC_NATIVE_REQUIREMENT)).toBe(false);
    expect(isBatchPayment(CIRCLE_GATEWAY_REQUIREMENT)).toBe(true);
  });

  it('accepts both X-PAYMENT and PAYMENT-SIGNATURE as encoded x402 payloads', () => {
    const xPayment = encodePaymentHeader(ARC_NATIVE_PAYMENT);
    const paymentSignature = encodePaymentHeader(CIRCLE_GATEWAY_PAYMENT);

    expect(decodePaymentHeader<typeof ARC_NATIVE_PAYMENT>(xPayment)).toMatchObject({ network: 'eip155:5042002' });
    expect(decodePaymentHeader<typeof CIRCLE_GATEWAY_PAYMENT>(paymentSignature)).toMatchObject({ network: 'arcTestnet' });
  });

  it('creates stable Gateway payment identifiers for replay protection', () => {
    const id1 = deriveGatewayPaymentId(CIRCLE_GATEWAY_PAYMENT, CIRCLE_GATEWAY_REQUIREMENT);
    const id2 = deriveGatewayPaymentId({ ...CIRCLE_GATEWAY_PAYMENT }, { ...CIRCLE_GATEWAY_REQUIREMENT });

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('creates a settled Arc Native receipt for agent execution', () => {
    const receipt = createArcNativeReceipt({
      payer: ARC_NATIVE_PAYMENT.payload.authorization.from,
      payTo: ARC_NATIVE_REQUIREMENT.payTo,
      amount: ARC_NATIVE_REQUIREMENT.amount,
      asset: ARC_NATIVE_REQUIREMENT.asset,
      network: ARC_NATIVE_REQUIREMENT.network,
      resource: '/api/agents/1/run',
      paymentId: 'exact:eip3009:test',
      txHash: '0x' + 'aa'.repeat(32),
      status: 'settled',
    });

    expect(receipt.provider).toBe('arc-native');
    expect(receipt.status).toBe('settled');
    expect(receipt.txHash).toMatch(/^0x/);
  });

  it('creates a Circle Gateway receipt that can be pending settlement but still verified', () => {
    const receipt = createGatewayReceipt({
      payer: CIRCLE_GATEWAY_PAYMENT.payload.authorization.from,
      payTo: CIRCLE_GATEWAY_REQUIREMENT.payTo,
      amount: CIRCLE_GATEWAY_REQUIREMENT.amount,
      asset: CIRCLE_GATEWAY_REQUIREMENT.asset,
      network: CIRCLE_GATEWAY_REQUIREMENT.network,
      resource: '/api/agents/1/run',
      paymentId: deriveGatewayPaymentId(CIRCLE_GATEWAY_PAYMENT, CIRCLE_GATEWAY_REQUIREMENT),
      status: 'accepted_pending_settlement',
    });

    expect(receipt.provider).toBe('circle-gateway');
    expect(receipt.status).toBe('accepted_pending_settlement');
    expect(receipt.paymentId).toMatch(/^[a-f0-9]{64}$/);
  });
});
