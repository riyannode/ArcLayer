export type DerivJobKeyRole =
  | 'deriv-client'
  | 'deriv-worker'
  | 'deriv-evaluator'
  | 'deriv-fullcycle-demo';

export const DERIV_JOB_TYPE_DEFAULT = 'deriv_signal_analysis';

export interface DerivJobKeyPolicy {
  role: DerivJobKeyRole;
  label: string;
  description: string;
  scopes: string[];
  envAgentFields: string[];
  productionSafe: boolean;
}

export const DERIV_JOB_KEY_POLICIES: Record<DerivJobKeyRole, DerivJobKeyPolicy> = {
  'deriv-client': {
    role: 'deriv-client',
    label: 'Deriv Client / Buyer',
    description: 'Creates jobs and settles verified results via x402. Does NOT claim/submit/verify.',
    scopes: ['jobs:create', 'jobs:settle'],
    envAgentFields: ['BUYER_AGENT_ID'],
    productionSafe: true,
  },
  'deriv-worker': {
    role: 'deriv-worker',
    label: 'Deriv Worker / Jobber',
    description: 'Claims available jobs and submits results. Does NOT create/verify/settle.',
    scopes: ['jobs:claim', 'jobs:submit'],
    envAgentFields: ['WORKER_ID', 'PROVIDER_AGENT_ID'],
    productionSafe: true,
  },
  'deriv-evaluator': {
    role: 'deriv-evaluator',
    label: 'Deriv Evaluator / Verifier',
    description: 'Verifies submitted job results. Does NOT create/claim/submit/settle.',
    scopes: ['jobs:verify'],
    envAgentFields: ['VERIFIER_AGENT_ID'],
    productionSafe: true,
  },
  'deriv-fullcycle-demo': {
    role: 'deriv-fullcycle-demo',
    label: 'Deriv Fullcycle Demo',
    description: 'One key runs create→claim→submit→verify→settle. For local testing/hackathon only. NOT production safe.',
    scopes: ['jobs:create', 'jobs:claim', 'jobs:submit', 'jobs:verify', 'jobs:settle'],
    envAgentFields: ['BUYER_AGENT_ID', 'WORKER_ID', 'PROVIDER_AGENT_ID', 'VERIFIER_AGENT_ID'],
    productionSafe: false,
  },
};

/**
 * Returns policy for a role string.
 * Returns null for unknown/empty/typo roles — caller must 400.
 * NEVER silently default to deriv-worker (least-privilege enforcement).
 */
export function getDerivJobKeyPolicy(role: string | undefined | null): DerivJobKeyPolicy | null {
  if (!role) return null;
  const clean = role.trim().toLowerCase();
  return DERIV_JOB_KEY_POLICIES[clean as DerivJobKeyRole] ?? null;
}

/** Returns all available role policies. */
export function listDerivJobKeyPolicies(): DerivJobKeyPolicy[] {
  return Object.values(DERIV_JOB_KEY_POLICIES);
}

/** Returns only production-safe role policies. */
export function listProductionSafePolicies(): DerivJobKeyPolicy[] {
  return Object.values(DERIV_JOB_KEY_POLICIES).filter((p) => p.productionSafe);
}
