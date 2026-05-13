import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, fallback, http, isHash } from 'viem';
import { ARC_RPC_URLS, CONTRACTS, arcTestnet } from '@arclayer/sdk';

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: fallback(ARC_RPC_URLS.map((url) => http(url))),
});

function paymentRequired(agentId: string) {
  return NextResponse.json(
    {
      error: 'payment_required',
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'arc-testnet',
          chainId: arcTestnet.id,
          asset: CONTRACTS.USDC,
          payTo: CONTRACTS.JOB_ESCROW,
          maxAmountRequired: '1000000',
          resource: `/api/agents/${agentId}/run`,
          description: 'Fund a JobEscrow run with testnet USDC, then retry with X-PAYMENT.',
          mimeType: 'application/json',
        },
      ],
    },
    { status: 402, headers: { 'X-402-Version': '1' } }
  );
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const agentId = params.id;
  const payment = req.headers.get('x-payment');
  const body = await req.json().catch(() => ({}));

  if (!payment) return paymentRequired(agentId);

  let txHash = payment;
  try {
    const parsed = JSON.parse(payment) as { txHash?: string };
    txHash = parsed.txHash || txHash;
  } catch {}

  if (!isHash(txHash)) {
    return NextResponse.json({ error: 'invalid_payment', message: 'X-PAYMENT must include a valid txHash.' }, { status: 400 });
  }

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt || receipt.status !== 'success' || receipt.to?.toLowerCase() !== CONTRACTS.JOB_ESCROW.toLowerCase()) {
    return NextResponse.json(
      { error: 'payment_not_settled', message: 'Payment transaction is not a confirmed JobEscrow funding call.' },
      { status: 402, headers: { 'X-402-Version': '1' } }
    );
  }

  return NextResponse.json({
    ok: true,
    agentId,
    jobId: body.jobId ?? null,
    payment: { chainId: arcTestnet.id, txHash },
    result: {
      status: 'queued',
      message: `Agent ${agentId} run accepted after x402 payment.`,
      input: body.input ?? body.prompt ?? null,
    },
  });
}
