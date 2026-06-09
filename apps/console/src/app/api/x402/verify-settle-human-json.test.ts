import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  verifyDualPayment: vi.fn(),
  settleDualPayment: vi.fn(),
}));

vi.mock('./_lib', () => ({
  verifyDualPayment: mocks.verifyDualPayment,
  settleDualPayment: mocks.settleDualPayment,
}));

import { POST as verifyPOST } from './verify/route';
import { POST as settlePOST } from './settle/route';

const PAYMENT_HEADERS = [
  'Cache-Control',
  'PAYMENT-RESPONSE',
  'X-PAYMENT',
  'X-PAYMENT-RESPONSE',
  'PAYMENT-SIGNATURE',
] as const;

function request(path: string, accept: string) {
  return new NextRequest(`https://console.test${path}`, {
    method: 'POST',
    headers: {
      accept,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ x402Version: 2 }),
  });
}

async function capture(res: Response) {
  const text = await res.text();
  return {
    status: res.status,
    headers: Object.fromEntries(PAYMENT_HEADERS.map((header) => [header, res.headers.get(header)])),
    body: JSON.parse(text),
    text,
  };
}

function expectSameSensitiveResponse(applicationJson: Awaited<ReturnType<typeof capture>>, textHtml: Awaited<ReturnType<typeof capture>>) {
  expect(textHtml.status).toBe(applicationJson.status);
  expect(textHtml.headers).toEqual(applicationJson.headers);
  expect(textHtml.body).toEqual(applicationJson.body);
  expect(applicationJson.text).not.toContain('\n  ');
  expect(textHtml.text).toContain('\n  ');
}

describe('x402 sensitive response formatting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('/api/x402/verify preserves status, sensitive headers, and body schema across Accept modes', async () => {
    mocks.verifyDualPayment.mockResolvedValue({
      parsed: { mode: 'native' },
      result: {
        isValid: false,
        invalidReason: 'insufficient_funds',
        payer: '0x1111111111111111111111111111111111111111',
      },
    });

    const applicationJson = await capture(await verifyPOST(request('/api/x402/verify', 'application/json')));
    const textHtml = await capture(await verifyPOST(request('/api/x402/verify', 'text/html')));

    expectSameSensitiveResponse(applicationJson, textHtml);
    expect(applicationJson.status).toBe(402);
    expect(applicationJson.body).toEqual({
      ok: false,
      mode: 'x402-native',
      isValid: false,
      invalidReason: 'insufficient_funds',
      payer: '0x1111111111111111111111111111111111111111',
    });
  });

  it('/api/x402/verify returns stable redacted errors when verification throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.verifyDualPayment.mockRejectedValue(new Error('raw provider stack secret'));

    const applicationJson = await capture(await verifyPOST(request('/api/x402/verify', 'application/json')));
    const textHtml = await capture(await verifyPOST(request('/api/x402/verify', 'text/html')));

    expectSameSensitiveResponse(applicationJson, textHtml);
    expect(applicationJson.status).toBe(502);
    expect(applicationJson.body).toEqual({
      ok: false,
      error: 'payment_verification_failed',
      message: 'Payment verification failed.',
    });
    expect(applicationJson.text).not.toContain('raw provider stack secret');
    expect(textHtml.text).not.toContain('raw provider stack secret');
    consoleError.mockRestore();
  });

  it('/api/x402/settle preserves status, sensitive headers, and body schema across Accept modes', async () => {
    mocks.settleDualPayment.mockResolvedValue({
      parsed: { mode: 'gateway' },
      result: {
        isValid: true,
        payer: '0x2222222222222222222222222222222222222222',
      },
      settleResult: {
        success: false,
        errorReason: 'settlement_pending',
        transaction: null,
      },
    });

    const applicationJson = await capture(await settlePOST(request('/api/x402/settle', 'application/json')));
    const textHtml = await capture(await settlePOST(request('/api/x402/settle', 'text/html')));

    expectSameSensitiveResponse(applicationJson, textHtml);
    expect(applicationJson.status).toBe(402);
    expect(applicationJson.body).toEqual({
      ok: false,
      mode: 'x402-circle-gateway',
      verify: {
        isValid: true,
        payer: '0x2222222222222222222222222222222222222222',
      },
      settle: {
        success: false,
        errorReason: 'settlement_pending',
        transaction: null,
      },
    });
  });

  it('/api/x402/settle returns stable redacted errors when settlement throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.settleDualPayment.mockRejectedValue(new Error('raw facilitator stack secret'));

    const applicationJson = await capture(await settlePOST(request('/api/x402/settle', 'application/json')));
    const textHtml = await capture(await settlePOST(request('/api/x402/settle', 'text/html')));

    expectSameSensitiveResponse(applicationJson, textHtml);
    expect(applicationJson.status).toBe(502);
    expect(applicationJson.body).toEqual({
      ok: false,
      error: 'payment_settlement_failed',
      message: 'Payment settlement failed.',
    });
    expect(applicationJson.text).not.toContain('raw facilitator stack secret');
    expect(textHtml.text).not.toContain('raw facilitator stack secret');
    consoleError.mockRestore();
  });
});
