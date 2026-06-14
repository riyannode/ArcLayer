import { getAddress } from 'viem';

/**
 * Platform-owned seller payout resolver.
 *
 * Use only for ArcLayer-owned resources (demo/protected platform APIs). A2A
 * seller routes must resolve payTo from service/profile database rows instead.
 */
export function getPlatformX402PayTo(): `0x${string}` {
  const raw = process.env.ARCLAYER_PLATFORM_X402_PAY_TO?.trim();
  if (!raw) {
    throw Object.assign(new Error('ARCLAYER_PLATFORM_X402_PAY_TO is required for platform-owned x402 routes'), { code: 'platform_pay_to_missing' });
  }
  try {
    return getAddress(raw) as `0x${string}`;
  } catch {
    throw Object.assign(new Error('ARCLAYER_PLATFORM_X402_PAY_TO must be a valid EVM address'), { code: 'platform_pay_to_invalid' });
  }
}
