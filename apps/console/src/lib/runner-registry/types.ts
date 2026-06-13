/**
 * Runner Registry types.
 * Console-side types for registered runners and dispatch logs.
 */

export type RunnerStatus = 'active' | 'paused' | 'revoked';
export type RuntimeKind = 'hermes' | 'openclaw' | 'custom';

export interface RunnerRegistryRow {
  id: string;
  runner_id: string;
  agent_id: string;
  name: string | null;
  endpoint: string;
  allowed_roles: string[];
  default_role: string;
  status: RunnerStatus;
  runtime_kind: RuntimeKind;
  hmac_secret: Buffer | null;
  metadata: Record<string, unknown>;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunnerDispatchLogRow {
  id: string;
  dispatch_id: string;
  runner_id: string;
  agent_id: string;
  task_id: string;
  role: string;
  request_path: string;
  request_body_hash: string;
  hmac_nonce: string;
  hmac_timestamp: string;
  status_code: number | null;
  response_body: Record<string, unknown> | null;
  error: string | null;
  proof_sha256: string | null;
  created_at: string;
}

/** Input for registering a new runner */
export interface RegisterRunnerInput {
  runnerId: string;
  agentId: string;
  name?: string;
  endpoint: string;
  allowedRoles?: string[];
  defaultRole?: string;
  runtimeKind?: RuntimeKind;
  hmacSecret: string; // plaintext — will be stored encrypted
  metadata?: Record<string, unknown>;
}

/** Input for dispatching a task to a runner */
export interface DispatchInput {
  agentId: string;
  taskId: string;
  role?: string;
  protocol?: 'erc8004' | 'erc8183' | 'x402' | 'generic';
  input: unknown;
  metadata?: Record<string, unknown>;
}

/** Result from a successful dispatch */
export interface DispatchResult {
  ok: boolean;
  dispatchId: string;
  runnerId: string;
  statusCode: number;
  result: unknown;
  proofSha256: string | null;
  durationMs: number;
}
