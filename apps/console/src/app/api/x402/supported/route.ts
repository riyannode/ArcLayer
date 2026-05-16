import { NextResponse } from 'next/server';
import {
  ARC_TESTNET_CAIP2_NETWORK,
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NETWORK,
  JOB_ESCROW_ADDRESS,
  PAYMENT_REQUIRED_HEADER,
  REPUTATION_ORACLE_ADDRESS,
  USDC_ADDRESS,
  WORK_PROOF_ADDRESS,
  X402_VERSION,
  X402_VERSION_V2,
} from '@/lib/x402';

export const runtime = 'nodejs';

export function GET() {
  const maxTimeoutSeconds = Number(process.env.X402_REQUIREMENT_TTL_SECONDS || '300');

  return NextResponse.json({
    // Canonical x402 V2 facilitator support
    kinds: [
      {
        x402Version: X402_VERSION_V2,
        scheme: 'exact',
        network: ARC_TESTNET_CAIP2_NETWORK,
        extra: {
          asset: USDC_ADDRESS,
          assetSymbol: 'USDC',
          decimals: 6,
          eip712: {
            name: 'USD Coin',
            version: '2',
            chainId: ARC_TESTNET_CHAIN_ID,
            verifyingContract: USDC_ADDRESS,
          },
          transferMethod: 'eip3009',
          maxTimeoutSeconds,
        },
      },
    ],

    // Current accepted schemes exposed by ArcLayer facilitator
    accepts: [
      {
        x402Version: X402_VERSION_V2,
        scheme: 'exact',
        network: ARC_TESTNET_CAIP2_NETWORK,
        asset: USDC_ADDRESS,
        assetSymbol: 'USDC',
        decimals: 6,
        facilitator: '/api/x402',
        verify: '/api/x402/verify',
        settle: '/api/x402/settle',
        maxTimeoutSeconds,
        extra: {
          name: 'USD Coin',
          version: '2',
          transferMethod: 'eip3009',
        },
      },
      {
        x402Version: X402_VERSION,
        scheme: 'arc-escrow',
        network: ARC_TESTNET_NETWORK,
        chainId: ARC_TESTNET_CHAIN_ID,
        asset: USDC_ADDRESS,
        assetSymbol: 'USDC',
        decimals: 6,
        facilitator: '/api/x402',
        jobEscrow: JOB_ESCROW_ADDRESS,
        maxTimeoutSeconds,
      },
    ],

    // legacy/additive compatibility
    facilitator: 'ArcLayer',
    version: String(X402_VERSION_V2),
    headers: {
      required: PAYMENT_REQUIRED_HEADER,
      response: 'PAYMENT-RESPONSE',
    },
    networks: [
      {
        network: ARC_TESTNET_CAIP2_NETWORK,
        name: 'Arc Testnet',
        chainId: ARC_TESTNET_CHAIN_ID,
        schemes: ['exact', 'arc-escrow', 'arclayer-escrow'],
        assets: [
          {
            symbol: 'USDC',
            address: USDC_ADDRESS,
            decimals: 6,
          },
        ],
        contracts: {
          jobEscrow: JOB_ESCROW_ADDRESS,
          workProof: WORK_PROOF_ADDRESS,
          reputationOracle: REPUTATION_ORACLE_ADDRESS,
        },
      },
    ],
  });
}
