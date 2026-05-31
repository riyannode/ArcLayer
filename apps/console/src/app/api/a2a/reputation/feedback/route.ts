import { NextResponse } from 'next/server';
import {
  buildReputationFeedback,
  writeReputationFeedback,
  type ReputationFeedbackInput,
} from '@/lib/a2a/reputation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type FeedbackBody = ReputationFeedbackInput & {
  dryRun?: boolean;
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function requireAdmin(request: Request) {
  const expected = process.env.REPUTATION_FEEDBACK_API_KEY;

  if (!expected) {
    throw new Error('missing_REPUTATION_FEEDBACK_API_KEY');
  }

  const received =
    request.headers.get('x-arclayer-admin-key') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (received !== expected) {
    throw new Error('unauthorized');
  }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);

    const body = (await request.json()) as FeedbackBody;

    if (body.dryRun) {
      const feedback = buildReputationFeedback(body);

      return json(200, {
        ok: true,
        dryRun: true,
        source: 'erc8004_reputation_registry',
        contract: feedback.config.address,
        functionName: feedback.config.functionName,
        args: feedback.config.args.map((arg) =>
          typeof arg === 'bigint' ? arg.toString() : arg,
        ),
        agentTokenId: feedback.agentTokenId.toString(),
        score: feedback.score.toString(),
        category: feedback.category,
        comment: feedback.comment,
        metadataURI: feedback.metadataURI,
        proofURI: feedback.proofURI,
        context: feedback.context,
        ref: feedback.ref,
      });
    }

    const result = await writeReputationFeedback(body);
    return json(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return json(
      message === 'unauthorized' ? 401 : 500,
      {
        ok: false,
        error: message,
        source: 'erc8004_reputation_registry',
      },
    );
  }
}
