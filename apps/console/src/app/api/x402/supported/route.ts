import { NextResponse } from 'next/server';
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NETWORK,
  JOB_ESCROW_ADDRESS,
  PAYMENT_REQUIRED_HEADER,
  REPUTATION_ORACLE_ADDRESS,
  USDC_ADDRESS,
  WORK_PROOF_ADDRESS,
  X402_VERSION,
} from '@/lib/x402';

export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json({
    // new facilitator contract
    x402Version: X402_VERSION,
    accepts: [
      {
        scheme: 'arc-escrow',
        network: ARC_TESTNET_NETWORK,
        chainId: ARC_TESTNET_CHAIN_ID,
        asset: USDC_ADDRESS,
        assetSymbol: 'USDC',
        facilitator: '/api/x402',
        jobEscrow: JOB_ESCROW_ADDRESS,
        maxTimeoutSeconds: Number(process.env.X402_REQUIREMENT_TTL_SECONDS || '300'),
      },
    ],

    // legacy/additive compatibility
    facilitator: 'ArcLayer',
    version: String(X402_VERSION),
    headers: {
      required: PAYMENT_REQUIRED_HEADER,
      response: 'PAYMENT-RESPONSE',
    },
    networks: [
      {
        network: 'eip155:5042002',
        name: 'Arc Testnet',
        chainId: ARC_TESTNET_CHAIN_ID,
        schemes: ['arclayer-escrow', 'exact', 'arc-escrow'],
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
