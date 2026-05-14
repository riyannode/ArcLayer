import { NextResponse } from 'next/server';
import { CONTRACTS } from '@arclayer/sdk';

export const runtime = 'edge';

export function GET() {
  return NextResponse.json({
    facilitator: 'ArcLayer',
    version: '1',
    networks: [
      {
        network: 'eip155:5042002',
        name: 'Arc Testnet',
        chainId: 5042002,
        schemes: ['arclayer-escrow', 'exact'],
        assets: [
          {
            symbol: 'USDC',
            address: CONTRACTS.USDC,
            decimals: 6,
          },
        ],
        contracts: {
          jobEscrow: CONTRACTS.JOB_ESCROW,
          workProof: CONTRACTS.WORK_PROOF,
          reputationOracle: CONTRACTS.REPUTATION_ORACLE,
        },
      },
    ],
  });
}
