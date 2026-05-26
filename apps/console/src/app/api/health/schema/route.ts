/**
 * GET /api/health/schema — verify expected DB columns/tables exist
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

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const expected: { table: string; columns: string[] }[] = [
      { table: 'agent_jobs', columns: ['settlement_mode', 'erc8183_job_id', 'erc8183_status'] },
      { table: 'agent_bridge_events', columns: ['event_dedupe_key', 'job_id', 'category'] },
      { table: 'agent_bridge_receipts', columns: ['session_id', 'event_id'] },
      { table: 'external_agent_runtimes', columns: ['runtime_id', 'agent_id'] },
      { table: 'x402_resource_payments', columns: ['payment_id', 'resource', 'status'] },
      { table: 'x402_native_payments', columns: ['payment_id', 'payer', 'status'] },
      { table: 'x402_native_claim_payment', columns: ['payment_id', 'status'] },
      { table: 'x402_native_consume_payment', columns: ['payment_id', 'status'] },
      { table: 'x402_gateway_payments', columns: ['payment_id', 'status'] },
      { table: 'x402_gateway_claim_settlement', columns: ['payment_id', 'status'] },
      { table: 'x402_gateway_consume_payment', columns: ['payment_id', 'status'] },
    ];

    const results: ColumnCheck[] = [];

    for (const { table, columns } of expected) {
      for (const column of columns) {
        const { data, error } = await supabase
          .from(table)
          .select(column, { head: true, count: 'exact' })
          .limit(1);

        results.push({
          table,
          column,
          present: !error && error?.code !== 'PGRST116' && error?.code !== '42P01',
        });

        if (error && error.code !== 'PGRST116') {
          // Table or column not found
        }
      }
    }

    const missing = results.filter((r) => !r.present);
    const healthy = missing.length === 0;

    return NextResponse.json({
      ok: healthy,
      status: healthy ? 'healthy' : 'degraded',
      checked: results.length,
      passed: results.length - missing.length,
      missing: missing.map((r) => `${r.table}.${r.column}`),
      details: results,
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
