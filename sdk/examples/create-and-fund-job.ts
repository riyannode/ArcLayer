import { createWalletClient, custom, parseUnits, type Address } from "viem";
import {
  arcTestnet,
  buildApproveUsdcConfig,
  buildCreateJobConfig,
  buildFundJobConfig,
  buildSetBudgetConfig,
} from "@arclayer/sdk";

declare global {
  interface Window {
    ethereum?: Parameters<typeof custom>[0];
  }
}

export async function createAndFundJob(params: {
  agentId: bigint;
  worker: Address;
  evaluator: Address;
  jobSpec: string;
  budgetUsdc: string;
}) {
  if (!window.ethereum) {
    throw new Error("No injected wallet found");
  }

  const walletClient = createWalletClient({
    chain: arcTestnet,
    transport: custom(window.ethereum),
  });
  const [account] = await walletClient.getAddresses();
  const budget = parseUnits(params.budgetUsdc, 6);

  const createHash = await walletClient.writeContract({
    account,
    ...buildCreateJobConfig(params.agentId, params.worker, params.evaluator, params.jobSpec),
  });

  // Replace this with the emitted JobCreated ID in production UIs.
  const jobId = 1n;

  const budgetHash = await walletClient.writeContract({
    account,
    ...buildSetBudgetConfig(jobId, budget),
  });
  const approveHash = await walletClient.writeContract({
    account,
    ...buildApproveUsdcConfig(budget),
  });
  const fundHash = await walletClient.writeContract({
    account,
    ...buildFundJobConfig(jobId, budget),
  });

  return { createHash, budgetHash, approveHash, fundHash };
}
