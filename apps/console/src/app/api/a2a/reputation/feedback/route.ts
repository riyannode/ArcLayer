import { humanJson } from '@/lib/api/human-json';

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

function json(request: Request, status: number, payload: Record<string, unknown>) {
  return humanJson(request, payload, { status });
}

const VALIDATION_ERRORS = new Set([
  'agentTokenId_required',
  'agentTokenId_must_be_integer',
  'agentTokenId_must_be_integer_string',
  'agentTokenId_invalid',
  'agentTokenId_must_be_positive',
  'score_required',
  'score_must_be_integer',
  'score_must_be_integer_string',
  'score_invalid',
  'score_out_of_manual_test_range',
  'category_must_be_integer',
  'category_out_of_uint8_range',
]);

function errorStatus(message: string): number {
  if (message === 'unauthorized') return 401;
  if (VALIDATION_ERRORS.has(message)) return 400;
  if (message === 'missing_REPUTATION_FEEDBACK_API_KEY') return 503;
  if (message === 'missing_or_invalid_REPUTATION_FEEDBACK_PRIVATE_KEY') return 503;
  return 500;
}

function publicErrorMessage(message: string): string {
  const status = errorStatus(message);
  if (status < 500) return message;
  return 'internal_error';
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

      return json(request, 200, {
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
    return json(request, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = errorStatus(message);
    const publicMessage = publicErrorMessage(message);

    console.error('reputation/feedback failed', error);

    return json(
      request,
      status,
      {
        ok: false,
        error: publicMessage,
        source: 'erc8004_reputation_registry',
      },
    );
  }
}
