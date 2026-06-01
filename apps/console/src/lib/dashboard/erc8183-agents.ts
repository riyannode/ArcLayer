export type DashboardAgentStatus = 'Open' | 'Funded' | 'Submitted' | 'Completed';

export type DashboardAgentType =
  | 'Smart Contract Agent'
  | 'Frontend Agent'
  | 'Backend Agent'
  | 'DevOps Agent'
  | 'Design Agent'
  | 'Data Research Agent'
  | 'Documentation Agent'
  | 'Analysis Agent'
  | 'Payment Agent'
  | 'Evaluator Agent'
  | 'Other';

export type DashboardAgentRow = {
  id: string;
  tokenId: string | null;
  title: string;
  description: string;
  category: DashboardAgentType;
  controller: string;
  owner: string;
  metadataURI: string;
  badge: string;
  budgetUsdc: number;
  jobCount: number;
  statusMeta: string;
  reputation: string;
  status: DashboardAgentStatus;
  profileHref: string;
};

function asArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function hasAny(values: string[], needles: string[]) {
  const normalized = values.map((value) => value.toLowerCase());
  return needles.some((needle) => normalized.some((v) => v.includes(needle)));
}

export function isErc8183CommerceAgent(agent: any) {
  const metadata = agent?.metadata || {};

  const values = [
    agent?.role,
    agent?.source,
    agent?.badge,
    metadata?.schema,
    metadata?.standard,
    metadata?.dashboard,
    metadata?.role,
    metadata?.x402,
    ...asArray(metadata?.tags),
    ...asArray(metadata?.categories),
    ...asArray(metadata?.capability),
    ...asArray(metadata?.capabilities),
    ...asArray(metadata?.skills),
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  // 1. Agent must have explicit ERC-8183 marker.
  const hasExplicitErc8183 =
    String(metadata?.standard || '').toLowerCase() === 'erc8183' ||
    String(metadata?.dashboard || '').toLowerCase() === 'erc8183' ||
    hasAny(values, ['erc8183', 'erc8183-commerce', 'job-commerce']);

  // 2. Agent must have job capability (ERC-8183 lifecycle markers).
  //    a2a_job is valid but only when paired with explicit ERC-8183 marker.
  const hasErc8183JobCapability = hasAny(values, [
    'claim_job',
    'submit_work',
    'submit_result',
    'approve_result',
    'settle_job',
    'job-creation',
    'escrow',
    'a2a_job',
  ]);

  // Both conditions required: explicit ERC-8183 AND job capability.
  // This excludes x402-only / payment-API agents that lack ERC-8183 markers.
  // A2A agents pass only when they declare ERC-8183 standard/dashboard/tags.
  return hasExplicitErc8183 && hasErc8183JobCapability;
}

export function mapDashboardAgentType(agent: any): DashboardAgentType {
  const metadata = agent?.metadata || {};
  const values = [
    agent?.role,
    metadata?.role,
    ...asArray(metadata?.tags),
    ...asArray(metadata?.categories),
    ...asArray(metadata?.capability),
    ...asArray(metadata?.capabilities),
    ...asArray(metadata?.skills),
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  if (values.some((v) => v.includes('smart') || v.includes('audit') || v.includes('security'))) {
    return 'Smart Contract Agent';
  }
  if (values.some((v) => v.includes('frontend') || v.includes('ui'))) return 'Frontend Agent';
  if (values.some((v) => v.includes('backend') || v.includes('api'))) return 'Backend Agent';
  if (values.some((v) => v.includes('devops') || v.includes('infra'))) return 'DevOps Agent';
  if (values.some((v) => v.includes('design'))) return 'Design Agent';
  if (values.some((v) => v.includes('data') || v.includes('research'))) return 'Data Research Agent';
  if (values.some((v) => v.includes('doc'))) return 'Documentation Agent';
  if (values.some((v) => v.includes('analysis') || v.includes('analyzer'))) return 'Analysis Agent';
  if (values.some((v) => v.includes('payment') || v.includes('x402'))) return 'Payment Agent';
  if (values.some((v) => v.includes('evaluator') || v.includes('review'))) return 'Evaluator Agent';

  return 'Other';
}

function parsePriceUsdc(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;

  const cleaned = value.replace(/[^\d.]/g, '');
  const parsed = Number.parseFloat(cleaned);

  return Number.isFinite(parsed) ? parsed : 0;
}

export function toDashboardAgentRow(agent: any): DashboardAgentRow {
  const metadata = agent?.metadata || {};
  const rawAgentId = String(agent?.agentId || '').trim();
  const tokenId = agent?.tokenId ? String(agent.tokenId).trim() : null;
  const profileId = tokenId || (/^\d+$/.test(rawAgentId) ? rawAgentId : '');
  const id = profileId || rawAgentId;
  const name = metadata?.name || agent?.name || `Agent ${id.slice(0, 8) || 'Unknown'}`;
  const jobs = Array.isArray(agent?.jobs) ? agent.jobs : [];
  const linkedJobCount = jobs.length;
  const reputation = String(agent?.reputationScore || agent?.score || '0');

  return {
    id,
    tokenId,
    title: String(name),
    description:
      String(metadata?.description || '') ||
      'ERC-8183 commerce agent available for escrow-backed work.',
    category: mapDashboardAgentType(agent),
    controller: String(agent?.controller || agent?.owner || ''),
    owner: String(agent?.owner || agent?.controller || ''),
    metadataURI: String(agent?.metadataURI || ''),
    badge: String(agent?.badge || 'ERC-8183 Commerce'),
    budgetUsdc: parsePriceUsdc(metadata?.price),
    jobCount: linkedJobCount,
    statusMeta:
      linkedJobCount > 0
        ? `${linkedJobCount} linked job${linkedJobCount === 1 ? '' : 's'}`
        : 'Available for escrow work',
    reputation,
    status: 'Open',
    profileHref: profileId ? `/agent/${encodeURIComponent(profileId)}` : '#',
  };
}
