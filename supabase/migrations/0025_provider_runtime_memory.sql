-- PR #461: Provider runtime memory + open job applications
-- 4 tables: agent_runtime_state, agent_job_runs, agent_job_checkpoints, provider_open_job_applications

-- Table 1: Durable runtime state per agent role
-- Supports provider now, evaluator later (generic role column)
CREATE TABLE IF NOT EXISTS agent_runtime_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL,
  role text NOT NULL DEFAULT 'provider',
  controller_address text,
  status text NOT NULL DEFAULT 'active',
  active_job_id text,
  active_run_id uuid,
  last_checkpoint text,
  last_error text,
  last_seen_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(agent_id, role)
);

CREATE INDEX IF NOT EXISTS idx_agent_runtime_state_agent ON agent_runtime_state(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runtime_state_role ON agent_runtime_state(role);

-- Table 2: Job runs (one per agent+job combination)
-- Idempotency key: provider:<agentId>:job:<jobId>
-- A run spans multiple phases; checkpoints are append-only within a run
CREATE TABLE IF NOT EXISTS agent_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL,
  role text NOT NULL DEFAULT 'provider',
  job_id text NOT NULL,
  run_status text NOT NULL DEFAULT 'active',
  phase text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_job_runs_agent ON agent_job_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_job_runs_job ON agent_job_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_agent_job_runs_status ON agent_job_runs(run_status);

-- Table 3: Checkpoints (append-only within a run)
-- Each checkpoint records a phase transition with optional tx/deliverable hashes
CREATE TABLE IF NOT EXISTS agent_job_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES agent_job_runs(id),
  agent_id text NOT NULL,
  job_id text NOT NULL,
  role text NOT NULL DEFAULT 'provider',
  phase text NOT NULL,
  status text NOT NULL,
  tx_hash text,
  deliverable_hash text,
  payload_hash text,
  note text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_job_checkpoints_run ON agent_job_checkpoints(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_job_checkpoints_agent ON agent_job_checkpoints(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_job_checkpoints_job ON agent_job_checkpoints(job_id);

-- Table 4: Provider open job applications
-- Provider-side memory for open/global job board
-- Client still assigns provider onchain via setProvider
CREATE TABLE IF NOT EXISTS provider_open_job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text NOT NULL,
  provider_agent_id text NOT NULL,
  provider_address text NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  quote_amount_atomic text,
  quote_amount_usdc text,
  message text,
  capabilities jsonb DEFAULT '[]',
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(job_id, provider_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_applications_job ON provider_open_job_applications(job_id);
CREATE INDEX IF NOT EXISTS idx_provider_applications_agent ON provider_open_job_applications(provider_agent_id);
CREATE INDEX IF NOT EXISTS idx_provider_applications_status ON provider_open_job_applications(status);
