import { describe, expect, it } from 'vitest';
import { ARC_TESTNET_CAIP2_NETWORK, GATEWAY_NETWORK_NAME, USDC_ADDRESS, X402_VERSION_V2 } from '../constants';
import { parseDualPaymentBody } from '@/app/api/x402/_lib';

const from = '0x1111111111111111111111111111111111111111';
const payTo = '0x2222222222222222222222222222222222222222';

function nativeBody(overrides: Record<string, unknown> = {}) {
  const requirements = {
    scheme: 'exact',
    network: ARC_TESTNET_CAIP2_NETWORK,
    asset: USDC_ADDRESS,
    amount: '1000',
    payTo,
    maxTimeoutSeconds: 300,
    extra: { name: 'USDC', version: '2', transferMethod: 'eip3009' },
  };

  return {
    x402Version: X402_VERSION_V2,
    mode: 'native',
    paymentRequirements: requirements,
    paymentPayload: {
      x402Version: X402_VERSION_V2,
      accepted: requirements,
      payload: {
        signature: `0x${'11'.repeat(65)}`,
        authorization: {
          from,
          to: payTo,
          value: '1000',
          validAfter: '0',
          validBefore: '9999999999',
          nonce: `0x${'00'.repeat(32)}`,
        },
      },
    },
    ...overrides,
  };
}

function gatewayBody(overrides: Record<string, unknown> = {}) {
  return {
    x402Version: X402_VERSION_V2,
    mode: 'gateway',
    paymentRequirements: {
      scheme: 'exact',
      network: GATEWAY_NETWORK_NAME,
      asset: USDC_ADDRESS,
      amount: '1000',
      payTo,
      maxTimeoutSeconds: 300,
      extra: { transferMethod: 'gateway-batched-eip3009' },
    },
    paymentPayload: {
      from,
      payload: { from },
    },
    ...overrides,
  };
}

describe('parseDualPaymentBody explicit rail mode', () => {
  it('routes explicit mode gateway with a gateway payload to gateway', () => {
    const parsed = parseDualPaymentBody(gatewayBody());
    expect(parsed).toMatchObject({ ok: true, mode: 'gateway' });
  });

  it('routes explicit mode native with a native exact payload to native', () => {
    const parsed = parseDualPaymentBody(nativeBody());
    expect(parsed).toMatchObject({ ok: true, mode: 'native' });
  });

  it('routes gateway by paymentRequirements.extra.name/version even when transferMethod and paymentPayload.extra are absent', () => {
    const parsed = parseDualPaymentBody(gatewayBody({
      mode: undefined,
      paymentRequirements: {
        scheme: 'exact',
        network: GATEWAY_NETWORK_NAME,
        asset: USDC_ADDRESS,
        amount: '1000',
        payTo,
        maxTimeoutSeconds: 300,
        extra: {
          name: 'GatewayWalletBatched',
          version: '1',
        },
      },
      paymentPayload: {
        from,
        payload: { from },
      },
    }));

    expect(parsed).toMatchObject({ ok: true, mode: 'gateway' });
  });

  it('rejects explicit mode gateway with a native payload', () => {
    const parsed = parseDualPaymentBody(nativeBody({ mode: 'gateway' }));
    expect(parsed).toMatchObject({ ok: false, status: 400, body: { error: 'rail_payload_mismatch' } });
  });

  it('rejects invalid explicit mode values', () => {
    const parsed = parseDualPaymentBody(nativeBody({ mode: 'arc-escrow' }));
    expect(parsed).toMatchObject({ ok: false, status: 400, body: { error: 'invalid_rail_mode' } });
  });
});
