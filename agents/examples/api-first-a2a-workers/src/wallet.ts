import { arcTestnet, buildCompleteJobConfig, buildSubmitDeliverableConfig } from '@arclayer/sdk';
import { createPublicClient, createWalletClient, fallback, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from './config.js';
import { logger } from './utils/logger.js';

function transports() {
  return [config.arcRpcUrl, config.arcRpcFallbackUrl].filter(Boolean).map((url) => http(url, { timeout: 10_000 }));
}

export const publicClient = createPublicClient({ chain: arcTestnet, transport: fallback(transports()) });

function walletClient(privateKey: string) {
  const account = privateKeyToAccount(privateKey as Hex);
  return { account, client: createWalletClient({ account, chain: arcTestnet, transport: fallback(transports()) }) };
}

export function addressFromPrivateKey(privateKey: string): `0x${string}` {
  return privateKeyToAccount(privateKey as Hex).address;
}

export async function submitOnchain(jobId: string | number | bigint, deliverableHash: Hex): Promise<Hex> {
  const { account, client } = walletClient(config.workerPrivateKey);
  logger.info('Submitting ERC-8183 deliverable', { onchainJobId: String(jobId), account: account.address });
  return client.writeContract({ account, chain: arcTestnet, ...buildSubmitDeliverableConfig(BigInt(jobId), deliverableHash) });
}

export async function completeOnchain(jobId: string | number | bigint, reasonHash: Hex): Promise<Hex> {
  const { account, client } = walletClient(config.evaluatorPrivateKey);
  logger.info('Completing ERC-8183 job', { onchainJobId: String(jobId), account: account.address });
  return client.writeContract({ account, chain: arcTestnet, ...buildCompleteJobConfig(BigInt(jobId), reasonHash) });
}
