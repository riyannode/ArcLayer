import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseUnits } from 'viem';

const getBalance = vi.fn();
const readContract = vi.fn();
const writeContract = vi.fn();
const waitForTransactionReceipt = vi.fn();

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ getBalance, readContract, waitForTransactionReceipt })),
    createWalletClient: vi.fn(() => ({ writeContract })),
  };
});

vi.mock('./native-payment-store', async () => {
  const actual = await vi.importActual<typeof import('./native-payment-store')>('./native-payment-store');
  return {
    ...actual,
    claimNativePayment: vi.fn(async () => ({ acquired: true })),
    markNativeFailed: vi.fn(async () => undefined),
    markNativeSettled: vi.fn(async () => undefined),
    backfillNativeSettled: vi.fn(async () => undefined),
  };
});

const validBefore = String(Math.floor(Date.now() / 1000) + 600);
const paymentPayload = {
  x402Version: 2,
  scheme: 'exact',
  network: 'eip155:5042002',
  payload: {
    authorization: {
      from: '0x9fC73BE13EAB35DD55547f89b1aD2663b9038eE5',
      to: '0x4aA3402575b6D98EacE35A823EFa267F7365bdD2',
      value: '10000',
      validAfter: '0',
      validBefore,
      nonce: '0x' + '11'.repeat(32),
    },
    signature: '0x' + '11'.repeat(65),
  },
} as any;

const paymentRequirements = {
  scheme: 'exact',
  network: 'eip155:5042002',
  asset: '0x3600000000000000000000000000000000000000',
  amount: '10000',
  payTo: '0x4aA3402575b6D98EacE35A823EFa267F7365bdD2',
  maxTimeoutSeconds: 300,
} as any;

describe('settleExactPayment relayer gas check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_RELAYER_PRIVATE_KEY = `0x${'12'.repeat(32)}`;
    getBalance.mockResolvedValue(0n);
  });

  it('returns relayer_unfunded when native balance is zero', async () => {
    const { settleExactPayment } = await import('./settle-exact');

    const result = await settleExactPayment({ paymentPayload, paymentRequirements });

    expect(result.success).toBe(false);
    expect(result.errorReason).toBe('relayer_unfunded');
    expect(getBalance).toHaveBeenCalled();
    expect(readContract).not.toHaveBeenCalled();
  });

  it('allows settlement path when native balance meets 0.01 threshold', async () => {
    const { settleExactPayment } = await import('./settle-exact');

    getBalance.mockResolvedValue(parseUnits('0.01', 18));
    writeContract.mockResolvedValue('0x' + 'aa'.repeat(32));
    waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

    const result = await settleExactPayment({ paymentPayload, paymentRequirements });

    expect(getBalance).toHaveBeenCalled();
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });
});
