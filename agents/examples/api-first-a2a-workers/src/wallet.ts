import {
  arcTestnet,
  buildCompleteJobConfig,
  buildSubmitDeliverableConfig,
  CONTRACTS,
  ERC8183_AGENTIC_COMMERCE_ABI,
} from '@arclayer/sdk';
import { createPublicClient, createWalletClient, decodeEventLog, fallback, getAddress, http, type Hex } from 'viem';
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

export async function submitOnchain(jobId: string | number | bigint, deliverableHash: Hex): Promise<Hex | undefined> {
  const { account, client } = walletClient(config.workerPrivateKey);
  const onchainJobId = BigInt(jobId);
  const job = await publicClient.readContract({
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: 'getJob',
    args: [onchainJobId],
  });
  const block = await publicClient.getBlock();
  if (block.timestamp > job.expiredAt) {
    logger.warn('onchain_job_expired', {
      onchainJobId: String(onchainJobId),
      status: job.status,
      expiredAt: String(job.expiredAt),
      currentBlockTimestamp: String(block.timestamp),
      account: account.address,
    });
    return undefined;
  }
  logger.info('Submitting ERC-8183 deliverable', { onchainJobId: String(onchainJobId), account: account.address });

  const submitTx = await client.writeContract({
    account,
    chain: arcTestnet,
    ...buildSubmitDeliverableConfig(onchainJobId, deliverableHash),
  });
  logger.info('ERC-8183 submit tx sent', { onchainJobId: String(onchainJobId), submitTx });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: submitTx });
  const logAddresses = [...new Set(receipt.logs.map((log) => getAddress(log.address)))];
  const topic0Values = [...new Set(receipt.logs.map((log) => log.topics[0]).filter(Boolean))];
  logger.info('ERC-8183 submit receipt', {
    onchainJobId: String(onchainJobId),
    submitTx,
    receiptStatus: receipt.status,
    receiptTo: receipt.to,
    logsCount: receipt.logs.length,
    logAddresses,
    topic0Values,
  });

  if (receipt.status !== 'success') throw new Error('submit_tx_failed');

  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(CONTRACTS.ERC8183_AGENTIC_COMMERCE)) continue;
    try {
      const decoded = decodeEventLog({
        abi: ERC8183_AGENTIC_COMMERCE_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== 'JobSubmitted') continue;
      const args = decoded.args as { jobId?: bigint; deliverable?: Hex };
      logger.info('ERC-8183 local JobSubmitted parsed', {
        eventName: decoded.eventName,
        jobId: args.jobId?.toString(),
        deliverable: args.deliverable,
      });
      return submitTx;
    } catch {
      // Not an ERC-8183 JobSubmitted log; continue scanning receipt diagnostics above.
    }
  }

  throw new Error('local_job_submitted_event_not_found');
}

export async function completeOnchain(jobId: string | number | bigint, reasonHash: Hex): Promise<Hex> {
  const { account, client } = walletClient(config.evaluatorPrivateKey);
  logger.info('Completing ERC-8183 job', { onchainJobId: String(jobId), account: account.address });
  return client.writeContract({ account, chain: arcTestnet, ...buildCompleteJobConfig(BigInt(jobId), reasonHash) });
}
