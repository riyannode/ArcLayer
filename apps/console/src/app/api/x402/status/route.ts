import { NextResponse } from 'next/server';
import { getAddress } from 'viem';
import { GATEWAY_NETWORK_NAME, USDC_ADDRESS, X402_VERSION_V2 } from '@/lib/x402/constants';
import { gatewayFacilitatorUrl, isGatewayEnabled } from '@/lib/x402/gateway/batch-client';
import { getGatewayContractAddressServer } from '@/lib/x402/gateway/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    x402Version: X402_VERSION_V2,
    rail: 'circle-gateway-batched-eip3009',
    network: 'arcTestnet',
    caip2Network: GATEWAY_NETWORK_NAME,
    asset: 'USDC',
    assetAddress: getAddress(USDC_ADDRESS),
    settlement: 'circle-gateway-batched',
    gateway: {
      enabled: isGatewayEnabled(),
      facilitatorUrl: gatewayFacilitatorUrl(),
      contractAddress: getGatewayContractAddressServer(),
    },
  });
}
