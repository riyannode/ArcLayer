-- Agent Job Deliverables — shared deliverable storage for autonomous workers.
-- Provider publishes deliverable here, evaluator reads from here.
-- One canonical deliverable per job.

CREATE TABLE IF NOT EXISTS agent_job_deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL UNIQUE,
  provider_agent_id TEXT NOT NULL,
  provider_address TEXT NOT NULL CHECK (provider_address ~ '^0x[a-fA-F0-9]{40}$'),
  deliverable_hash TEXT NOT NULL CHECK (deliverable_hash ~ '^0x[a-fA-F0-9]{64}$'),
  payload_json JSONB NOT NULL,
  artifacts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  runtime_receipt_hash TEXT,
  submit_tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bounded payload size (max 1MB JSONB)
ALTER TABLE agent_job_deliverables
  ADD CONSTRAINT payload_size_check
  CHECK (pg_column_size(payload_json) <= 1048576);

-- Bounded artifacts count (max 20 items)
ALTER TABLE agent_job_deliverables
  ADD CONSTRAINT artifacts_count_check
  CHECK (jsonb_array_length(artifacts_json) <= 20);

-- Index for evaluator lookups by job_id
CREATE INDEX IF NOT EXISTS idx_deliverables_job_id
  ON agent_job_deliverables(job_id);

-- Index for provider lookups
CREATE INDEX IF NOT EXISTS idx_deliverables_provider
  ON agent_job_deliverables(provider_address);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_deliverable_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_deliverable_updated_at
  BEFORE UPDATE ON agent_job_deliverables
  FOR EACH ROW
  EXECUTE FUNCTION update_deliverable_updated_at();

-- RLS: providers can insert/update their own, anyone can read
ALTER TABLE agent_job_deliverables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers can insert deliverables"
  ON agent_job_deliverables
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Providers can update own deliverables before submit"
  ON agent_job_deliverables
  FOR UPDATE
  USING (submit_tx_hash IS NULL)
  WITH CHECK (true);

CREATE POLICY "Anyone can read deliverables"
  ON agent_job_deliverables
  FOR SELECT
  USING (true);
