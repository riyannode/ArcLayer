import { getAddress } from 'viem';
import { GATEWAY_WALLET_ADDRESS } from '../constants';
import { getArcTestnetGatewayConfig } from './batch-client';

const GATEWAY_CONTRACT_MISMATCH_ERROR =
  'Gateway contract address mismatch: server and public Gateway contract addresses differ.';

function normalizeGatewayContractAddress(value: string): `0x${string}` {
  return getAddress(value) as `0x${string}`;
}

/**
 * Canonical server-side GatewayWallet contract address resolver.
 *
 * This is the Circle Gateway contract used as `verifyingContract` and deposit
 * target. It is not a payer wallet; payers remain per-agent EOAs.
 */
export function getGatewayContractAddressServer(): `0x${string}` {
  const selected = normalizeGatewayContractAddress(
    process.env.X402_GATEWAY_CONTRACT_ADDRESS ||
      process.env.X402_GATEWAY_WALLET_ADDRESS ||
      getArcTestnetGatewayConfig().gatewayWallet,
  );

  const clientAddress = normalizeGatewayContractAddress(
    process.env.NEXT_PUBLIC_X402_GATEWAY_CONTRACT_ADDRESS ||
      process.env.NEXT_PUBLIC_X402_GATEWAY_WALLET_ADDRESS ||
      GATEWAY_WALLET_ADDRESS,
  );

  if (clientAddress !== selected) {
    throw new Error(GATEWAY_CONTRACT_MISMATCH_ERROR);
  }

  return selected;
}
