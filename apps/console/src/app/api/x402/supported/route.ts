import { NextResponse } from 'next/server';
import {
  ARC_TESTNET_CAIP2_NETWORK,
  ARC_TESTNET_CHAIN_ID,
  CIRCLE_BATCHING_NAME,
  CIRCLE_BATCHING_VERSION,
  GATEWAY_NETWORK_NAME,
  getArcTestnetGatewayConfig,
  PAYMENT_REQUIRED_HEADER,
  USDC_ADDRESS,
  X402_VERSION_V2,
} from '@/lib/x402';

export const runtime = 'nodejs';

const DEFAULT_AMOUNT_ATOMIC = '1';
const DEFAULT_PAY_TO = '0x4aA3402575b6D98EacE35A823EFa267F7365bdD2';

function gatewayWalletAddress() {
  return process.env.X402_GATEWAY_WALLET_ADDRESS || getArcTestnetGatewayConfig().gatewayWallet;
}

export function GET() {
  const maxTimeoutSeconds = Number(process.env.X402_REQUIREMENT_TTL_SECONDS || '300');
  const amount = process.env.X402_DEMO_AMOUNT_ATOMIC || DEFAULT_AMOUNT_ATOMIC;
  const payTo = process.env.X402_RECEIVER_ADDRESS || process.env.X402_PAY_TO || DEFAULT_PAY_TO;

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
      verifyingContract: gatewayWalletAddress(),
      supportedChain: GATEWAY_NETWORK_NAME,
      transferMethod: 'gateway-batched-eip3009',
      status: 'live',
    },
  };

  return NextResponse.json({
    kinds: [
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
      {
        x402Version: X402_VERSION_V2,
        scheme: 'exact',
        network: GATEWAY_NETWORK_NAME,
        extra: {
          asset: USDC_ADDRESS,
          assetSymbol: 'USDC',
          decimals: 6,
          name: CIRCLE_BATCHING_NAME,
          version: CIRCLE_BATCHING_VERSION,
          verifyingContract: gatewayWalletAddress(),
          maxTimeoutSeconds,
        },
      },
    ],
    accepts: [arcNativeExact, gatewayBatched],
    facilitator: 'ArcLayer',
    version: String(X402_VERSION_V2),
    headers: {
      arcNative: 'X-PAYMENT',
      gatewayPreferred: 'PAYMENT-SIGNATURE',
      required: PAYMENT_REQUIRED_HEADER,
      response: 'PAYMENT-RESPONSE',
    },
    networks: [
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
        contracts: { gatewayWallet: gatewayWalletAddress() },
      },
    ],
  });
}
