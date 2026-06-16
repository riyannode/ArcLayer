import { humanJson } from '@/lib/api/human-json';
/**
 * GET /api/health/schema — verify expected DB columns, tables, and RPC functions exist
 */
import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ColumnCheck {
  table: string;
  column: string;
  present: boolean;
}

interface RpcCheck {
  name: string;
  present: boolean;
}

async function checkRpcFunctions(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  expected: string[],
): Promise<(RpcCheck & { error?: string })[]> {
  const { data, error } = await supabase.rpc('arclayer_check_public_routines', {
    names: expected,
  });

  if (error) {
    return expected.map((name) => ({
      name,
      present: false,
      error: error.message,
    }));
  }

  const present = new Set(
    (data ?? []).map((row: { routine_name?: string }) => row.routine_name),
  );

  return expected.map((name) => ({
    name,
    present: present.has(name),
  }));
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    // --- Expected tables/columns ---
    const expected: { table: string; columns: string[] }[] = [
      { table: 'agent_jobs', columns: ['settlement_mode', 'erc8183_job_id', 'erc8183_status'] },
      { table: 'agent_bridge_events', columns: ['event_dedupe_key', 'job_id', 'category'] },
      { table: 'agent_bridge_receipts', columns: ['session_id', 'event_id'] },
      { table: 'external_agent_runtimes', columns: ['runtime_id', 'agent_id'] },
      { table: 'x402_resource_payments', columns: ['payment_id', 'resource', 'status'] },
      // x402_native_payments table kept as historical record — no longer a runtime dependency
      { table: 'x402_gateway_payments', columns: ['payment_id', 'status'] },
    ];

    const columnResults: ColumnCheck[] = [];

    for (const { table, columns } of expected) {
      for (const column of columns) {
        const { data, error } = await supabase
          .from(table)
          .select(column, { head: true, count: 'exact' })
          .limit(1);

        columnResults.push({
          table,
          column,
          present: !error,
        });

        if (error) {
          const pgErr = error as { code?: string; message?: string };
          console.warn(`[health/schema] ${table}.${column} — ${pgErr.code ?? '?'}: ${pgErr.message ?? error}`);
        }
      }
    }

    // --- Expected RPC functions ---
    const expectedRpc = [
      'x402_native_claim_payment',
      'x402_native_consume_payment',
      'x402_gateway_claim_settlement',
      'x402_gateway_consume_payment',
    ];

    let rpcResults: (RpcCheck & { error?: string })[] = [];
    let rpcError: string | null = null;

    try {
      rpcResults = await checkRpcFunctions(supabase, expectedRpc);
    } catch (err) {
      rpcError = err instanceof Error ? err.message : 'rpc_check_failed';
      console.warn(`[health/schema] RPC check error: ${rpcError}`);
      rpcResults = expectedRpc.map((name) => ({
        name,
        present: false,
        error: 'check_failed',
      }));
    }

    const columnMissing = columnResults.filter((r) => !r.present);
    const rpcMissing = rpcResults.filter((r) => !r.present);
    const totalMissing = columnMissing.length + rpcMissing.length;
    const healthy = totalMissing === 0;

    return humanJson(req, {
      ok: healthy,
      status: healthy ? 'healthy' : 'degraded',
      columns: {
        checked: columnResults.length,
        passed: columnResults.length - columnMissing.length,
        missing: columnMissing.map((r) => `${r.table}.${r.column}`),
        details: columnResults,
      },
      rpcFunctions: {
        checked: rpcResults.length,
        passed: rpcResults.filter((r) => r.present).length,
        missing: rpcMissing.map((r) => r.name),
        details: rpcResults,
        error: rpcError,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return humanJson(req, { ok: false, status: 'error', error: message, timestamp: new Date().toISOString() }, { status: 500 });
  }
}
