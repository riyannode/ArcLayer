import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const categories = [
  'Smart Contract',
  'Frontend',
  'Backend',
  'DevOps',
  'Design',
  'Data Research',
  'Documentation',
  'Analysis',
  'Other',
] as const;

const schema = z.object({
  title: z.string().trim().min(4).max(140),
  category: z.enum(categories),
  description: z.string().trim().min(10).max(2500),
  deliverables: z.string().trim().min(3).max(2500),
  requirements: z.string().trim().min(3).max(2000),
  timeline: z.string().trim().min(1).max(64),
  budgetMin: z.string().trim().optional().default(''),
  budgetMax: z.string().trim().optional().default(''),
});

function parseBudget(value: string) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: 'invalid_payload',
          message: parsed.error.issues[0]?.message ?? 'Invalid escrow work order payload.',
        },
        { status: 400 },
      );
    }

    const budgetMin = parseBudget(parsed.data.budgetMin);
    const budgetMax = parseBudget(parsed.data.budgetMax);

    if (parsed.data.budgetMin && budgetMin === null) {
      return NextResponse.json(
        {
          ok: false,
          error: 'invalid_budget_min',
          message: 'Minimum budget must be a valid USDC amount.',
        },
        { status: 400 },
      );
    }

    if (parsed.data.budgetMax && budgetMax === null) {
      return NextResponse.json(
        {
          ok: false,
          error: 'invalid_budget_max',
          message: 'Maximum budget must be a valid USDC amount.',
        },
        { status: 400 },
      );
    }

    if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) {
      return NextResponse.json(
        {
          ok: false,
          error: 'invalid_budget_range',
          message: 'Minimum budget cannot be greater than maximum budget.',
        },
        { status: 400 },
      );
    }

    const jobId = `escrow_${crypto.randomUUID()}`;

    const jobSpec = {
      id: jobId,
      type: 'escrow_work_order',
      paymentRail: 'erc8183_escrow',
      title: parsed.data.title,
      category: parsed.data.category,
      description: parsed.data.description,
      deliverables: parsed.data.deliverables,
      requirements: parsed.data.requirements,
      timeline: parsed.data.timeline,
      budget: {
        currency: 'USDC',
        min: budgetMin,
        max: budgetMax,
      },
      status: 'created_pending_funding',
      createdAt: new Date().toISOString(),
    };

    /*
      TODO: Production wire-in:
      1. Persist jobSpec to your backend/indexer DB.
      2. Create or prepare ERC-8183 escrow work order.
      3. Return the real jobId from the indexer/contract event.
      4. Redirect UI to /job/[id] after indexer confirms it.
    */

    return NextResponse.json({
      ok: true,
      jobId,
      job: jobSpec,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: 'server_error',
        message: 'Unable to create escrow work order.',
      },
      { status: 500 },
    );
  }
}
