import { NextResponse } from 'next/server';
import { gatewayEvidenceSummary, probeGatewayRuntimeSupport } from '@/lib/x402';

export const runtime = 'nodejs';

/**
 * Public gateway health check.
 * SECURITY: Only expose aggregate counts (stored/used).
 * Individual payment records are REDACTED to prevent payer/payTo/status leakage.
 */
export async function GET() {
  try {
    const probe = await probeGatewayRuntimeSupport();
    const evidence = await gatewayEvidenceSummary();
    return NextResponse.json({
      ok: probe.ok,
      readiness: probe.ok ? 'runtime_supported' : 'arcTestnet_not_returned_by_runtime',
      gateway: probe,
      evidence: { stored: evidence.stored, used: evidence.used },
      note: 'Circle API keys are not required for the normal Gateway/Nanopayments facilitator flow.',
    }, { status: probe.ok ? 200 : 503 });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      readiness: 'probe_failed',
      error: err instanceof Error ? err.message : String(err),
      evidence: { stored: 0, used: 0 },
    }, { status: 502 });
  }
}
