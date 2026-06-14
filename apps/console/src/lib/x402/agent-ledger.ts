/**
 * x402 Agent Payment Ledger — audit trail for per-agent x402 payments.
 *
 * Records every x402 payment attempt with agent context.
 * NOT tied to ERC-8183 job lifecycle (separate concern).
 * Called only from x402 settlement success/failure paths.
 *
 * Scope: x402 payment layer only.
 */

import { getSupabaseAdmin } from './supabaseClient';

export interface AgentX402LedgerEntry {
  agentId: string;
  controllerAddress: string;
  payerAddress: string;
  expectedPayer: string;
  runtimeId?: string | null;
  sessionId?: string | null;
  jobId?: string | null;
  resource: string;
  rail: 'circle-gateway';
  amount: string;
  currency?: 'USDC';
  paymentId?: string | null;
  settlementRef?: string | null;
  txHash?: string | null;
  status: 'verified' | 'settled' | 'consumed' | 'failed' | 'replayed';
  receipt?: Record<string, unknown>;
}

/**
 * Record an x402 payment ledger entry.
 * Called after settlement success or failure, NOT from ERC-8183.
 */
export async function recordAgentX402Ledger(
  input: AgentX402LedgerEntry,
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from('agent_x402_payment_ledger').insert({
      agent_id: input.agentId,
      controller_address: input.controllerAddress,
      payer_address: input.payerAddress,
      expected_payer: input.expectedPayer,
      runtime_id: input.runtimeId ?? null,
      session_id: input.sessionId ?? null,
      job_id: input.jobId ?? null,
      resource: input.resource,
      rail: input.rail,
      amount: input.amount,
      currency: input.currency ?? 'USDC',
      payment_id: input.paymentId ?? null,
      settlement_ref: input.settlementRef ?? null,
      tx_hash: input.txHash ?? null,
      status: input.status,
      receipt: input.receipt ?? {},
    });
  } catch (err) {
    // Ledger recording is operational, not financial.
    // Log but do not throw — payment already settled/failed.
    console.error('[x402-ledger] Failed to record ledger entry:', err);
  }
}
