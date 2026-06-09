import { NextResponse } from 'next/server';
import {
  ARC_TESTNET_CAIP2_NETWORK,
  ARC_TESTNET_CHAIN_ID,
  CIRCLE_BATCHING_NAME,
  CIRCLE_BATCHING_VERSION,
  GATEWAY_NETWORK_NAME,
  isGatewayEnabled,
  PAYMENT_REQUIRED_HEADER,
  USDC_ADDRESS,
  X402_VERSION_V2,
} from '@/lib/x402';
import { getGatewayContractAddressServer } from '@/lib/x402/gateway/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_AMOUNT_ATOMIC = '1';

export function GET() {
  const maxTimeoutSeconds = Number(process.env.X402_REQUIREMENT_TTL_SECONDS || '300');
  const amount = process.env.X402_DEMO_AMOUNT_ATOMIC || DEFAULT_AMOUNT_ATOMIC;
  const payTo = process.env.X402_RECEIVER_ADDRESS || process.env.X402_PAY_TO;
  if (!payTo) throw new Error('Missing X402_RECEIVER_ADDRESS or X402_PAY_TO');
  const gatewayContractAddress = getGatewayContractAddressServer();

  const arcNativeExact = {
    x402Version: X402_VERSION_V2,
    scheme: 'exact',
    network: ARC_TESTNET_CAIP2_NETWORK,
    asset: USDC_ADDRESS,
    assetSymbol: 'USDC',
    decimals: 6,
    amount,
    payTo,
    facilitator: '/api/x402',
    maxTimeoutSeconds,
    extra: {
      name: 'USDC',
      version: '2',
      transferMethod: 'eip3009',
    },
  };

  const gatewayBatched = {
    x402Version: X402_VERSION_V2,
    scheme: 'exact',
    network: GATEWAY_NETWORK_NAME,
    asset: USDC_ADDRESS,
    assetSymbol: 'USDC',
    decimals: 6,
    amount,
    payTo,
    facilitator: '/api/x402',
    maxTimeoutSeconds,
    extra: {
      name: CIRCLE_BATCHING_NAME,
      version: CIRCLE_BATCHING_VERSION,
      verifyingContract: gatewayContractAddress,
      supportedChain: GATEWAY_NETWORK_NAME,
      transferMethod: 'gateway-batched-eip3009',
      status: 'live',
    },
  };

  const gatewayEnabled = isGatewayEnabled();
  const kinds: Array<Record<string, unknown>> = [
    {
      x402Version: X402_VERSION_V2,
      scheme: 'exact',
      network: ARC_TESTNET_CAIP2_NETWORK,
      extra: {
        asset: USDC_ADDRESS,
        assetSymbol: 'USDC',
        decimals: 6,
        eip712: { name: 'USDC', version: '2', chainId: ARC_TESTNET_CHAIN_ID, verifyingContract: USDC_ADDRESS },
        transferMethod: 'eip3009',
        maxTimeoutSeconds,
      },
    },
  ];
  if (gatewayEnabled) {
    kinds.push({
      x402Version: X402_VERSION_V2,
      scheme: 'exact',
      network: GATEWAY_NETWORK_NAME,
      extra: {
        asset: USDC_ADDRESS,
        assetSymbol: 'USDC',
        decimals: 6,
        name: CIRCLE_BATCHING_NAME,
        version: CIRCLE_BATCHING_VERSION,
        verifyingContract: gatewayContractAddress,
        maxTimeoutSeconds,
      },
    });
  }

  return NextResponse.json({
    kinds,
    accepts: gatewayEnabled ? [arcNativeExact, gatewayBatched] : [arcNativeExact],
    facilitator: 'ArcLayer',
    version: String(X402_VERSION_V2),
    headers: {
      arcNative: 'X-PAYMENT',
      gatewayPreferred: 'PAYMENT-SIGNATURE',
      required: PAYMENT_REQUIRED_HEADER,
      response: 'PAYMENT-RESPONSE',
    },
    networks: gatewayEnabled
      ? [
        {
          network: ARC_TESTNET_CAIP2_NETWORK,
          name: 'Arc Testnet',
          chainId: ARC_TESTNET_CHAIN_ID,
          schemes: ['exact'],
          assets: [{ symbol: 'USDC', address: USDC_ADDRESS, decimals: 6 }],
        },
        {
          network: GATEWAY_NETWORK_NAME,
          name: 'Circle Gateway Arc Testnet',
          chainId: ARC_TESTNET_CHAIN_ID,
          schemes: ['exact'],
          assets: [{ symbol: 'USDC', address: USDC_ADDRESS, decimals: 6 }],
          contracts: { gatewayWallet: gatewayContractAddress },
        },
      ]
      : [
        {
          network: ARC_TESTNET_CAIP2_NETWORK,
          name: 'Arc Testnet',
          chainId: ARC_TESTNET_CHAIN_ID,
          schemes: ['exact'],
          assets: [{ symbol: 'USDC', address: USDC_ADDRESS, decimals: 6 }],
        },
      ],
  });
}
