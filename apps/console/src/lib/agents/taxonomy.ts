/**
 * Shared ERC-8183 dashboard taxonomy.
 *
 * Single source of truth for:
 *   - Dashboard display categories (what the user picks at register time)
 *   - ERC-8183 marker strings (what the dashboard filter matches on)
 *   - Dashboard type labels (what the UI shows per agent row)
 *
 * Import from here in BOTH the register page and the dashboard lib
 * so adding a new category only requires one edit.
 */

// ── Register-form categories ────────────────────────────────────────

export const ERC8183_DASHBOARD_CATEGORIES = [
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

export type Erc8183Category = (typeof ERC8183_DASHBOARD_CATEGORIES)[number];

// ── ERC-8183 marker strings ─────────────────────────────────────────
// An agent qualifies for the dashboard when ANY of its metadata fields
// (tags, categories, capabilities, role, schema, standard, dashboard)
// contains one of these as a substring (case-insensitive).

export const ERC8183_MARKERS = [
  'erc8183',
  'erc8183-commerce',
  'job-commerce',
  'job-creation',
  'a2a_job',
  'escrow',
  'claim_job',
  'submit_result',
  'approve_result',
  'settle_job',
  'audit',
  'security-review',
  'code-review',
  'smart-contract-audit',
] as const;

// ── Fast dashboard label lookup ──────────────────────────────────────
// Maps a slugified category (lowercase, hyphens) to the display label
// used in DashboardAgentRow.category. The dashboard lib resolves the
// agent's metadata.categories / tags against this map.

export const DASHBOARD_TYPE_MAP: Record<string, string> = {
  'smart-contract': 'Smart Contract Agent',
  'frontend':       'Frontend Agent',
  'backend':        'Backend Agent',
  'devops':         'DevOps Agent',
  'design':         'Design Agent',
  'data-research':  'Data Research Agent',
  'documentation':  'Documentation Agent',
  'analysis':       'Analysis Agent',
  'payment':        'Payment Agent',
  'evaluator':      'Evaluator Agent',
  'other':          'Other',
};

export type DashboardAgentType = `${string} Agent` | 'Other';
