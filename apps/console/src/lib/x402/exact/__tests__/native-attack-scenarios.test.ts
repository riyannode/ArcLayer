import { beforeEach, describe, expect, it, vi } from 'vitest';

const viemMock = vi.hoisted(() => {
  const readContract = vi.fn();
  return {
    readContract,
    verifyTypedData: vi.fn(async () => true),
  };
});

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ readContract: viemMock.readContract })),
    verifyTypedData: viemMock.verifyTypedData,
  };
});

import { ARC_TESTNET_CAIP2_NETWORK, USDC_ADDRESS } from '../../constants';
import { parseExactVerifyRequest, verifyExactEvmPayment } from '../verify-exact';

const PAY_TO = '0x4aA3402575b6D98EacE35A823EFa267F7365bdD2';
const FROM = '0x9fC73BE13EAB35DD55547f89b1aD2663b9038eE5';
const OTHER = '0x0000000000000000000000000000000000000001';
const AMOUNT = '10000';
const FUTURE = String(Math.floor(Date.now() / 1000) + 600);
const NONCE = '0x' + '11'.repeat(32);
const SIGNATURE = '0x' + '22'.repeat(65);

function makeBody(overrides: Record<string, unknown> = {}) {
  const body = {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      accepted: {
        scheme: 'exact',
        network: ARC_TESTNET_CAIP2_NETWORK,
        asset: USDC_ADDRESS,
        amount: AMOUNT,
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
      },
      payload: {
        signature: SIGNATURE,
        authorization: {
          from: FROM,
          to: PAY_TO,
          value: AMOUNT,
          validAfter: '0',
          validBefore: FUTURE,
          nonce: NONCE,
        },
      },
    },
    paymentRequirements: {
      scheme: 'exact',
      network: ARC_TESTNET_CAIP2_NETWORK,
      asset: USDC_ADDRESS,
      amount: AMOUNT,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      extra: { name: 'USDC', version: '2', transferMethod: 'eip3009' },
    },
  };
  return Object.assign(body, overrides);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function parsedPayment(body = makeBody()) {
  const parsed = parseExactVerifyRequest(body);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed;
}

describe('Arc Native x402 attack scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viemMock.readContract.mockReset();
    viemMock.verifyTypedData.mockResolvedValue(true);
  });

  it('rejects wrong payTo / authorization.to mismatch', () => {
    const body = deepClone(makeBody());
    body.paymentPayload.payload.authorization.to = OTHER;

    const parsed = parseExactVerifyRequest(body);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe('invalid_recipient');
  });

  it('rejects wrong amount / authorization.value mismatch', () => {
    const body = deepClone(makeBody());
    body.paymentPayload.payload.authorization.value = '9999';

    const parsed = parseExactVerifyRequest(body);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe('invalid_amount');
  });

  it('rejects wrong asset before signature verification', () => {
    const body = deepClone(makeBody());
    body.paymentRequirements.asset = OTHER as typeof USDC_ADDRESS;

    const parsed = parseExactVerifyRequest(body);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe('unsupported_asset');
  });

  it('rejects expired authorization window', async () => {
    const body = deepClone(makeBody());
    body.paymentPayload.payload.authorization.validBefore = '1000';
    const parsed = parsedPayment(body);

    const result = await verifyExactEvmPayment({
      paymentPayload: parsed.paymentPayload,
      paymentRequirements: parsed.paymentRequirements,
      nowSeconds: 2000,
    });

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe('expired');
    expect(viemMock.readContract).not.toHaveBeenCalled();
  });

  it('rejects replayed nonce already used on-chain', async () => {
    const parsed = parsedPayment();
    viemMock.readContract
      .mockResolvedValueOnce('USDC')
      .mockResolvedValueOnce('2')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(BigInt(AMOUNT));

    const result = await verifyExactEvmPayment({
      paymentPayload: parsed.paymentPayload,
      paymentRequirements: parsed.paymentRequirements,
    });

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe('nonce_used');
  });

  it('rejects insufficient payer balance', async () => {
    const parsed = parsedPayment();
    viemMock.readContract
      .mockResolvedValueOnce('USDC')
      .mockResolvedValueOnce('2')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(BigInt(AMOUNT) - 1n);

    const result = await verifyExactEvmPayment({
      paymentPayload: parsed.paymentPayload,
      paymentRequirements: parsed.paymentRequirements,
    });

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe('insufficient_balance');
  });
});
