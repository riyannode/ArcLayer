import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
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

const USDC_SYMBOL = 'USDC';
const USDC_DECIMALS = 6;

const GATEWAY_RAIL_ID = 'circle-gateway-batched-eip3009';

const RECOMMENDED_PAYMENT_HEADER = 'PAYMENT-SIGNATURE';
const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';

function formatUsdcAtomic(amount: string): string {
  const normalized = amount.trim();

  if (!/^\d+$/.test(normalized)) {
    return `${amount} atomic USDC`;
  }

  const value = BigInt(normalized);
  const base = 10n ** BigInt(USDC_DECIMALS);
  const whole = value / base;
  const fraction = value % base;
  const fractionText = fraction
    .toString()
    .padStart(USDC_DECIMALS, '0')
    .replace(/0+$/, '');

  return fractionText ? `${whole}.${fractionText} USDC` : `${whole} USDC`;
}

export function GET(req: NextRequest) {
  const maxTimeoutSeconds = Number(process.env.X402_REQUIREMENT_TTL_SECONDS || '300');
  const amount = process.env.X402_DEMO_AMOUNT_ATOMIC || DEFAULT_AMOUNT_ATOMIC;
  const payTo = process.env.X402_RECEIVER_ADDRESS || process.env.X402_PAY_TO;
  const gatewayEnabled = isGatewayEnabled();
  const gatewayContractAddress = gatewayEnabled ? getGatewayContractAddressServer() : null;
  const displayAmount = formatUsdcAtomic(amount);

  const gatewayBatched = gatewayContractAddress
    ? {
      rail: GATEWAY_RAIL_ID,
      x402Version: X402_VERSION_V2,
      scheme: 'exact',
      network: GATEWAY_NETWORK_NAME,
      asset: USDC_ADDRESS,
      assetSymbol: USDC_SYMBOL,
      decimals: USDC_DECIMALS,
      amount,
      amountAtomic: amount,
      displayAmount,
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
    }
    : null;

  const kinds: Array<Record<string, unknown>> = [];

  if (gatewayContractAddress) {
    kinds.push({
      rail: GATEWAY_RAIL_ID,
      x402Version: X402_VERSION_V2,
      scheme: 'exact',
      network: GATEWAY_NETWORK_NAME,
      extra: {
        asset: USDC_ADDRESS,
        assetSymbol: USDC_SYMBOL,
        decimals: USDC_DECIMALS,
        name: CIRCLE_BATCHING_NAME,
        version: CIRCLE_BATCHING_VERSION,
        verifyingContract: gatewayContractAddress,
        transferMethod: 'gateway-batched-eip3009',
        supportedChain: GATEWAY_NETWORK_NAME,
        maxTimeoutSeconds,
        status: 'live',
      },
    });
  }

  const accepts: Array<Record<string, unknown>> = [];
  if (gatewayBatched && payTo) accepts.push(gatewayBatched);

  const rails: Array<Record<string, unknown>> = [];

  if (gatewayContractAddress) {
    rails.push({
      id: GATEWAY_RAIL_ID,
      label: 'Circle Gateway Batched EIP-3009',
      status: 'live',
      recommendedFor:
        'Agent-to-agent nanopayments and batched settlement using Circle Gateway.',
      x402Version: X402_VERSION_V2,
      scheme: 'exact',
      network: GATEWAY_NETWORK_NAME,
      chainId: ARC_TESTNET_CHAIN_ID,
      asset: USDC_ADDRESS,
      assetSymbol: USDC_SYMBOL,
      decimals: USDC_DECIMALS,
      transferMethod: 'gateway-batched-eip3009',
      gatewayWallet: gatewayContractAddress,
      supportedChain: GATEWAY_NETWORK_NAME,
      header: RECOMMENDED_PAYMENT_HEADER,
    });
  }

  const networks = gatewayContractAddress
    ? [
      {
        network: GATEWAY_NETWORK_NAME,
        name: 'Circle Gateway Arc Testnet',
        chainId: ARC_TESTNET_CHAIN_ID,
        rail: GATEWAY_RAIL_ID,
        note: 'Circle Gateway is a payment rail on Arc Testnet, not a separate chain.',
        schemes: ['exact'],
        assets: [{ symbol: USDC_SYMBOL, address: USDC_ADDRESS, decimals: USDC_DECIMALS }],
        contracts: { gatewayWallet: gatewayContractAddress },
      },
    ]
    : [];

  return humanJson(req, {
    description:
      'ArcLayer x402 discovery endpoint for Arc Testnet. Circle Gateway batched EIP-3009 only. Arc Native x402 has been removed.',

    kinds,
    accepts,

    facilitator: 'ArcLayer',
    version: String(X402_VERSION_V2),

    recommendedHeader: RECOMMENDED_PAYMENT_HEADER,

    headers: {
      recommended: RECOMMENDED_PAYMENT_HEADER,

      required: PAYMENT_REQUIRED_HEADER,
      response: PAYMENT_RESPONSE_HEADER,
    },

    endpoints: {
      supported: '/api/x402/supported',
      verify: '/api/x402/verify',
      settle: '/api/x402/settle',
      facilitator: '/api/x402',
    },

    notes: [
      'This endpoint is for discovery only.',
      'Protected resources return a 402 challenge with PAYMENT-REQUIRED.',
      `Amounts are USDC atomic units. USDC has ${USDC_DECIMALS} decimals, so amount 1 means 0.000001 USDC.`,
      'Circle Gateway is a payment rail on Arc Testnet, not a separate chain.',
      'Arc Native x402 runtime has been removed. Use Circle Gateway PAYMENT-SIGNATURE.',
      'X-PAYMENT header is deprecated and unsupported.',
    ],

    rails,
    networks,
  });
}
