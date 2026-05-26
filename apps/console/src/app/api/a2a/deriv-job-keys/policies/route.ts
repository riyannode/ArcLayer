import { NextRequest, NextResponse } from 'next/server';
import {
  listDerivJobKeyPolicies,
  listProductionSafePolicies,
  DERIV_JOB_TYPE_DEFAULT,
} from '@/lib/a2a/deriv-job-key-policy';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/a2a/deriv-job-keys/policies
 * GET /api/a2a/deriv-job-keys/policies?includeDemo=true
 *
 * Returns available Deriv A2A job role policies.
 * By default excludes deriv-fullcycle-demo (productionSafe: false).
 * Pass ?includeDemo=true to show all roles including demo.
 *
 * Used by the frontend key manager to populate the role selector.
 */
export async function GET(req: NextRequest) {
  const includeDemo = req.nextUrl.searchParams.get('includeDemo') === 'true';
  const source = includeDemo ? listDerivJobKeyPolicies() : listProductionSafePolicies();

  const roles = source.map((p) => ({
    role: p.role,
    label: p.label,
    description: p.description,
    scopes: p.scopes,
    envAgentFields: p.envAgentFields,
    productionSafe: p.productionSafe,
  }));

  return NextResponse.json(
    {
      ok: true,
      jobTypeDefault: DERIV_JOB_TYPE_DEFAULT,
      roles,
    },
    {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
