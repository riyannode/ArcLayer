/**
 * ERC-8183 Escrow Job types.
 *
 * These types extend the shared agent_jobs table with ERC-8183-specific fields.
 * The table is shared with x402 off-chain jobs using settlement_mode='erc8183_escrow'.
 *
 * Flow:
 *   createJob(on-chain) → setBudget → approve/fund → claim(off-chain) →
 *   running(off-chain) → submit → complete(on-chain escrow settlement)
 */

export const ERC8183_STATUSES = [
  'Open',
  'Funded',
  'Submitted',
  'Completed',
  'Rejected',
  'Expired',
] as const;

export type Erc8183Status = (typeof ERC8183_STATUSES)[number];

/**
 * Input for createLocalErc8183Job.
 * Maps API fields to the shared agent_jobs table columns.
 */
export interface CreateErc8183JobInput {
  buyerAgentId: string;
  clientAddress: string;
  providerAgentId: string;
  providerAddress: string;
  evaluatorAgentId?: string;
  evaluatorAddress?: string;
  expiredAtUnix: string;
  description: string;
  hookAddress: string;
  budgetAtomic: string;
  inputPayload: Record<string, unknown>;
}

/**
 * Transaction instruction returned by ERC-8183 job routes.
 * Clients sign and broadcast these — server never holds private keys.
 */
export interface TxInstruction {
  address: string;
  functionName: string;
  args: unknown[];
}

/**
 * Full ERC-8183 job view returned by GET endpoints.
 */
export interface Erc8183JobView {
  localJobId: string;
  erc8183JobId: string | null;
  settlementMode: 'erc8183_escrow';
  erc8183Status: Erc8183Status | null;
  status: string;
  buyerAgentId: string;
  clientAddress: string | null;
  providerAgentId: string | null;
  providerAddress: string | null;
  evaluatorAgentId: string | null;
  evaluatorAddress: string | null;
  workerId: string | null;
  priceAtomic: string;
  description: string | null;
  expiredAtUnix: string | null;
  hookAddress: string | null;
  inputPayload: Record<string, unknown>;
  inputPayloadHash: string;
  resultPayload: Record<string, unknown> | null;
  resultPayloadHash: string | null;
  proofPayload: Record<string, unknown> | null;
  proofPayloadHash: string | null;
  deliverableHash: string | null;
  reasonHash: string | null;
  createTxHash: string | null;
  setBudgetTxHash: string | null;
  approveTxHash: string | null;
  fundTxHash: string | null;
  submitTxHash: string | null;
  completeTxHash: string | null;
  createdAt: string;
  claimedAt: string | null;
  startedAt: string | null;
}
