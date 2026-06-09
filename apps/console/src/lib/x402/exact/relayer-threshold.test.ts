import { afterEach, describe, expect, it } from 'vitest';
import { parseRelayerNativeGasThreshold } from './settle-exact';

describe('parseRelayerNativeGasThreshold', () => {
  const original = process.env.X402_MIN_RELAYER_NATIVE_GAS;

  afterEach(() => {
    if (original === undefined) delete process.env.X402_MIN_RELAYER_NATIVE_GAS;
    else process.env.X402_MIN_RELAYER_NATIVE_GAS = original;
  });

  it('defaults to 0.01 when env is missing', () => {
    delete process.env.X402_MIN_RELAYER_NATIVE_GAS;
    expect(parseRelayerNativeGasThreshold()).toBe(10_000_000_000_000_000n);
  });

  it('falls back to 0.01 when env is invalid', () => {
    process.env.X402_MIN_RELAYER_NATIVE_GAS = 'not-a-number';
    expect(parseRelayerNativeGasThreshold()).toBe(10_000_000_000_000_000n);
  });

  it('uses a custom env threshold', () => {
    process.env.X402_MIN_RELAYER_NATIVE_GAS = '0.25';
    expect(parseRelayerNativeGasThreshold()).toBe(250_000_000_000_000_000n);
  });
});
