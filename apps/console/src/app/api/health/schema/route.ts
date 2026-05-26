/**
 * GET /api/health/schema — verify expected DB columns, tables, and RPC functions exist
 */
import { NextResponse } from 'next/server';
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

/** Extract project ref from supabase URL */
function extractProjectRef(url: string): string | null {
  const match = url.match(/https?:\/\/([^.]+)\.supabase\.co/);
  return match?.[1] ?? null;
}

/** Query RPC function existence via Management API raw SQL query */
async function checkRpcFunctions(
  projectRef: string,
  serviceKey: string,
  expected: string[],
): Promise<RpcCheck[]> {
  const sql = `SELECT proname FROM pg_proc WHERE proname IN (${expected.map((n) => `'${n}'`).join(',')});`;

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );

  if (!res.ok) {
    // Management API not available — default to unknown
    return expected.map((name) => ({ name, present: false, error: 'management_api_unavailable' })) as unknown as RpcCheck[];
  }

  const rows = await res.json();
  if (!Array.isArray(rows)) {
    return expected.map((name) => ({ name, present: false, error: 'unexpected_response' })) as unknown as RpcCheck[];
  }

  const present = new Set(rows.map((r: { proname?: string }) => r.proname));
  return expected.map((name) => ({ name, present: present.has(name) }));
}

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    const projectRef = extractProjectRef(supabaseUrl);

    // --- Expected tables/columns ---
    const expected: { table: string; columns: string[] }[] = [
      { table: 'agent_jobs', columns: ['settlement_mode', 'erc8183_job_id', 'erc8183_status'] },
      { table: 'agent_bridge_events', columns: ['event_dedupe_key', 'job_id', 'category'] },
      { table: 'agent_bridge_receipts', columns: ['session_id', 'event_id'] },
      { table: 'external_agent_runtimes', columns: ['runtime_id', 'agent_id'] },
      { table: 'x402_resource_payments', columns: ['payment_id', 'resource', 'status'] },
      { table: 'x402_native_payments', columns: ['payment_id', 'payer', 'status'] },
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

    if (projectRef && serviceKey) {
      try {
        rpcResults = await checkRpcFunctions(projectRef, serviceKey, expectedRpc);
      } catch (err) {
        rpcError = err instanceof Error ? err.message : 'rpc_check_failed';
        console.warn(`[health/schema] RPC check error: ${rpcError}`);
        rpcResults = expectedRpc.map((name) => ({ name, present: false, error: 'check_failed' }));
      }
    } else {
      rpcError = 'project_ref_or_key_missing';
      rpcResults = expectedRpc.map((name) => ({ name, present: false, error: rpcError! }));
    }

    const columnMissing = columnResults.filter((r) => !r.present);
    const rpcMissing = rpcResults.filter((r) => !r.present && !r.error?.startsWith('check_'));
    const totalMissing = columnMissing.length + rpcMissing.length;
    const healthy = totalMissing === 0;

    return NextResponse.json({
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
    return NextResponse.json(
      { ok: false, status: 'error', error: message, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
