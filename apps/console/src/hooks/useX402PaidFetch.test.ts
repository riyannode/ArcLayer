import { describe, expect, it } from 'vitest';
import { parsePaymentResponseTxHash } from './useX402PaidFetch';

describe('useX402PaidFetch helpers', () => {
  it('parses transaction from PAYMENT-RESPONSE', () => {
    const header = btoa(JSON.stringify({ transaction: '0xabc' }));
    expect(parsePaymentResponseTxHash(header)).toBe('0xabc');
  });

  it('parses txHash fallback from PAYMENT-RESPONSE', () => {
    const header = btoa(JSON.stringify({ txHash: '0xdef' }));
    expect(parsePaymentResponseTxHash(header)).toBe('0xdef');
  });

  it('returns undefined for invalid PAYMENT-RESPONSE payload', () => {
    expect(parsePaymentResponseTxHash('nope')).toBeUndefined();
    expect(parsePaymentResponseTxHash(null)).toBeUndefined();
  });
});
