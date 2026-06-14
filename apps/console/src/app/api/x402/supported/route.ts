import { NextResponse } from 'next/server';
import { getAddress } from 'viem';
import { X402_VERSION_V2, GATEWAY_NETWORK_NAME, USDC_ADDRESS, CIRCLE_BATCHING_NAME, CIRCLE_BATCHING_VERSION } from '@/lib/x402/constants';
import { gatewayFacilitatorUrl, isGatewayEnabled } from '@/lib/x402/gateway/batch-client';
import { getGatewayContractAddressServer } from '@/lib/x402/gateway/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const gatewayEnabled = isGatewayEnabled();
  const accepted = gatewayEnabled ? [{
    rail: 'circle-gateway-batched-eip3009',
    scheme: 'exact',
    network: GATEWAY_NETWORK_NAME,
    asset: getAddress(USDC_ADDRESS),
    extra: {
      name: CIRCLE_BATCHING_NAME,
      version: CIRCLE_BATCHING_VERSION,
      transferMethod: 'gateway-batched-eip3009',
      verifyingContract: getGatewayContractAddressServer(),
      supportedChain: GATEWAY_NETWORK_NAME,
    },
  }] : [];

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
      enabled: gatewayEnabled,
      facilitatorUrl: gatewayFacilitatorUrl(),
      contractAddress: getGatewayContractAddressServer(),
    },
    acceptedRails: ['circle-gateway-batched-eip3009'],
    accepts: accepted,
    headers: {
      required: 'PAYMENT-REQUIRED',
      proof: 'PAYMENT-SIGNATURE',
      response: 'PAYMENT-RESPONSE',
    },
  });
}
