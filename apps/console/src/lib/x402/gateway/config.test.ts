import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getAddress } from 'viem';
import { GET as getSupported } from '@/app/api/x402/supported/route';
import { getGatewayContractAddressClient } from '../constants';
import { testBuildGatewayRequirements } from '../middleware';
import { getArcTestnetGatewayConfig, isBatchPayment } from './batch-client';
import { getGatewayContractAddressServer } from './config';

const ENV_KEYS = [
  'X402_GATEWAY_CONTRACT_ADDRESS',
  'X402_GATEWAY_WALLET_ADDRESS',
  'NEXT_PUBLIC_X402_GATEWAY_CONTRACT_ADDRESS',
  'NEXT_PUBLIC_X402_GATEWAY_WALLET_ADDRESS',
  'X402_GATEWAY_ENABLED',
  'X402_RECEIVER_ADDRESS',
  'X402_PAY_TO',
] as const;

const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

function clearGatewayEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe('Gateway contract address config', () => {
  it('throws when server and public Gateway contract addresses differ', () => {
    clearGatewayEnv();
    process.env.X402_GATEWAY_CONTRACT_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    process.env.NEXT_PUBLIC_X402_GATEWAY_CONTRACT_ADDRESS = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    expect(() => getGatewayContractAddressServer()).toThrow(
      'Gateway contract address mismatch: server and public Gateway contract addresses differ.',
    );
  });

  it('falls back to the SDK Arc Testnet GatewayWallet contract address', () => {
    clearGatewayEnv();

    expect(getGatewayContractAddressServer()).toBe(
      getAddress(getArcTestnetGatewayConfig().gatewayWallet),
    );
  });

  it('uses the same Gateway contract as middleware verifyingContract and remains Circle batch-compatible', () => {
    clearGatewayEnv();
    process.env.X402_GATEWAY_CONTRACT_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    process.env.NEXT_PUBLIC_X402_GATEWAY_CONTRACT_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    const requirements = testBuildGatewayRequirements({
      amount: '1',
      resource: '/api/test',
      payTo: '0xcccccccccccccccccccccccccccccccccccccccc',
    });

    expect(requirements.payTo).toBe(getAddress('0xcccccccccccccccccccccccccccccccccccccccc'));
    expect(requirements.payTo).not.toBe(getGatewayContractAddressServer());
    expect(requirements.extra.verifyingContract).toBe(getGatewayContractAddressServer());
    expect(isBatchPayment(requirements)).toBe(true);
  });

  it('returns supported Gateway rail metadata without a global Gateway accept by default', async () => {
    clearGatewayEnv();
    process.env.X402_GATEWAY_CONTRACT_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    process.env.NEXT_PUBLIC_X402_GATEWAY_CONTRACT_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    process.env.X402_GATEWAY_ENABLED = 'true';
    process.env.X402_RECEIVER_ADDRESS = '0xcccccccccccccccccccccccccccccccccccccccc';
    const response = getSupported();
    const body = await response.json();
    const gatewayAccept = body.accepts.find(
      (accept: { extra?: { transferMethod?: string } }) =>
        accept.extra?.transferMethod === 'gateway-batched-eip3009',
    );
    const requirements = testBuildGatewayRequirements({
      amount: '1',
      resource: '/api/test',
      payTo: '0xcccccccccccccccccccccccccccccccccccccccc',
    });
    const gatewayKind = body.kinds.find(
      (kind: { network?: string; extra?: { name?: string } }) =>
        kind.extra?.name === 'GatewayWalletBatched',
    );
    const gatewayNetwork = body.networks.find(
      (network: { contracts?: { gatewayWallet?: string } }) =>
        network.contracts?.gatewayWallet,
    );

    expect(gatewayKind).toBeDefined();
    expect(gatewayAccept).toBeUndefined();
    expect(gatewayNetwork.contracts.gatewayWallet).toBe(requirements.extra.verifyingContract);
  });

  it('resolves the browser Gateway contract helper for deposit targets', () => {
    clearGatewayEnv();
    process.env.NEXT_PUBLIC_X402_GATEWAY_CONTRACT_ADDRESS = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    expect(getGatewayContractAddressClient()).toBe(
      getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
    );
  });

  it('keeps Gateway deposits wired to the Gateway contract helper, not payer_address', () => {
    const source = readFileSync('src/hooks/useGatewayDeposit.ts', 'utf8');

    expect(source).toContain('getGatewayContractAddressClient');
    expect(source).toContain('const GATEWAY_WALLET = getGatewayContractAddressClient();');
    expect(source).toContain('args: [address as Address, GATEWAY_WALLET]');
    expect(source).toContain('args: [GATEWAY_WALLET, amountUnits]');
    expect(source).toContain('address: GATEWAY_WALLET');
    expect(source).not.toContain('payer_address');
  });
});
