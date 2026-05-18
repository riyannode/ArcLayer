import { NextResponse } from 'next/server';
import { isGatewayEnabled, probeGatewayRuntimeSupport } from '@/lib/x402';

export const runtime = 'nodejs';

export async function GET() {
  const gateway = await probeGatewayRuntimeSupport().catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return NextResponse.json({
    ok: true,
    facilitator: 'ArcLayer',
    version: 2,
    rails: {
      native: {
        enabled: true,
        scheme: 'exact',
        network: 'eip155:5042002',
        transferMethod: 'eip3009',
        settleMode: 'self-hosted-relayer',
      },
      circleGateway: {
        enabled: isGatewayEnabled(),
        scheme: 'exact',
        network: 'eip155:5042002',
        transferMethod: 'gateway-batched-eip3009',
        runtime: gateway,
      },
    },
    legacy: {
      arcEscrow: false,
    },
  });
}
