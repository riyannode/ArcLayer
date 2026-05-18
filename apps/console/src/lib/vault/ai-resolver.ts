export type ResolverDecision = 'release' | 'refund' | 'split' | 'escalate';

export type AiResolverInput = {
  jobId: string;
  milestoneId: string;
  specJson: unknown;
  deliverableUri?: string | null;
  feedbackUri?: string | null;
  evidence?: unknown;
  revisionCount: number;
};

export type AiResolverOutput = {
  decision: ResolverDecision;
  confidence: number;
  reason: string;
  matchedCriteria: string[];
  missingEvidence: string[];
  recommendedSplit?: {
    clientBps: number;
    jobberBps: number;
  };
};

const DEFAULT_ENDPOINT = process.env.AI_RESOLVER_ENDPOINT || 'http://localhost:20128/v1';
const DEFAULT_MODEL = process.env.AI_RESOLVER_MODEL || 'KIRO';
const DEFAULT_THRESHOLD = Number(process.env.AI_RESOLVER_CONFIDENCE_THRESHOLD || '0.92');

function extractJson(text: string): AiResolverOutput {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  const parsed = JSON.parse(candidate) as AiResolverOutput;

  if (!['release', 'refund', 'split', 'escalate'].includes(parsed.decision)) {
    throw new Error('Invalid AI resolver decision');
  }
  if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
    throw new Error('Invalid AI resolver confidence');
  }
  if (parsed.decision === 'split') {
    const split = parsed.recommendedSplit;
    if (!split || split.clientBps + split.jobberBps !== 10000) {
      throw new Error('Invalid AI resolver split');
    }
  }

  return {
    decision: parsed.decision,
    confidence: parsed.confidence,
    reason: parsed.reason || '',
    matchedCriteria: Array.isArray(parsed.matchedCriteria) ? parsed.matchedCriteria : [],
    missingEvidence: Array.isArray(parsed.missingEvidence) ? parsed.missingEvidence : [],
    recommendedSplit: parsed.recommendedSplit,
  };
}

export async function runAiResolver(input: AiResolverInput): Promise<{
  output: AiResolverOutput;
  autoFinal: boolean;
}> {
  const prompt = `You are ArcLayer Tier-0 AI Resolver. Decide ONLY based on immutable job spec and evidence.\n\nRules:\n- If jobber submitted nothing / unusable empty deliverable, decision=refund.\n- If spec asks exact objective deliverables and submitted evidence clearly matches, decision=release.\n- If evidence is partial, decision=split with bps.\n- If subjective, ambiguous, missing evidence, or confidence < threshold, decision=escalate.\n- Never reward scope creep. Client dissatisfaction beyond original spec is not a valid rejection.\n- Return strict JSON only. No markdown.\n\nThreshold for auto-final: ${DEFAULT_THRESHOLD}.\n\nInput JSON:\n${JSON.stringify(input, null, 2)}\n\nOutput schema:\n{\n  "decision": "release | refund | split | escalate",\n  "confidence": 0.0,\n  "reason": "short explanation",\n  "matchedCriteria": ["..."],\n  "missingEvidence": ["..."],\n  "recommendedSplit": { "clientBps": 0, "jobberBps": 10000 }\n}`;

  const res = await fetch(`${DEFAULT_ENDPOINT.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.AI_RESOLVER_API_KEY ? { authorization: `Bearer ${process.env.AI_RESOLVER_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an impartial escrow dispute resolver. Return strict JSON only.' },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`AI resolver failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI resolver returned empty content');

  const output = extractJson(content);
  const autoFinal = output.decision !== 'escalate' && output.confidence >= DEFAULT_THRESHOLD;
  return { output, autoFinal };
}
