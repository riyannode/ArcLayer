export type BridgeEvent = {
  id: string;
  session_id: string;
  runtime_id?: string | null;
  agent_id?: string | null;
  job_id?: string | null;
  category?: string | null;
  role: string;
  type?: string;
  event_type?: string;
  payload_hash: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  source?: string | null;
  dry_run?: boolean;
  created_at: string;
};

export type BridgeReceipt = {
  id: string;
  session_id: string;
  receipt_type: string;
  payload_hash: string;
  proof_uri?: string | null;
  payment_ref?: string | null;
  payment_id?: string | null;
  transaction?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type BridgeSession = {
  sessionId: string;
  roles: Record<string, BridgeEvent | null>;
  events: BridgeEvent[];
  receipts: BridgeReceipt[];
};

export const EXAMPLE_PM2_PIPELINE_ROLES = ['oracle', 'analyzer', 'momentum_resolver', 'scalping_resolver', 'evaluator', 'executor'] as const;

export const EXTERNAL_AGENT_ROLE_LABELS: Record<string, string> = {
  external_runtime: 'External Runtime',
  registered_agent: 'Registered Agent',
  verification: 'Verification',
  executor: 'Dry-Run Executor',
  oracle: 'Oracle / Raw Market Snapshot',
  analyzer: 'Local / LLM Analyzer',
  momentum_resolver: 'Momentum Resolver',
  scalping_resolver: 'Scalping Resolver',
  evaluator: 'Risk Evaluator',
  spot_trader: 'Spot Trader',
  prediction_market_trader: 'Prediction Market Trader',
  arbitrage_bot: 'Arbitrage Bot',
  research_agent: 'Research Agent',
  data_provider: 'Data Provider',
  risk_manager: 'Risk Manager',
  rwa_evaluator: 'RWA Evaluator',
  custom_worker: 'Custom Worker',
};

export function roleLabel(role: string) {
  return EXTERNAL_AGENT_ROLE_LABELS[role] || role.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function eventType(event: BridgeEvent) {
  return event.event_type || event.type || 'bridge_event';
}

export function shortHash(value?: string | null) {
  if (!value) return '—';
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}
