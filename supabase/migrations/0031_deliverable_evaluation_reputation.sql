-- 0031: agent_job_deliverables + agent_job_evaluations
-- PR 2: Deliverable and evaluation storage for ERC-8183 production lifecycle

-- ── Deliverables ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_job_deliverables (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                text NOT NULL,
  provider_agent_id     text NOT NULL,
  provider_address      text NOT NULL,
  evaluator_address     text,
  schema_version        integer NOT NULL DEFAULT 1,
  canonical_payload     text NOT NULL,
  deliverable_hash      text NOT NULL,
  artifacts_json        jsonb NOT NULL DEFAULT '[]',
  runtime_receipt_hash  text,
  submit_tx_hash        text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  locked_at             timestamptz,

  -- Constraints
  CONSTRAINT uq_deliverable_job UNIQUE (job_id),
  CONSTRAINT ck_deliverable_hash_format CHECK (deliverable_hash ~ '^0x[a-fA-F0-9]{64}$'),
  CONSTRAINT ck_deliverable_payload_size CHECK (octet_length(canonical_payload) <= 1048576),  -- 1 MB max
  CONSTRAINT ck_deliverable_artifacts_count CHECK (jsonb_array_length(artifacts_json) <= 32),
  CONSTRAINT ck_deliverable_schema_version CHECK (schema_version = 1)
);

CREATE INDEX IF NOT EXISTS idx_deliverable_job ON agent_job_deliverables (job_id);
CREATE INDEX IF NOT EXISTS idx_deliverable_provider ON agent_job_deliverables (provider_agent_id);
CREATE INDEX IF NOT EXISTS idx_deliverable_hash ON agent_job_deliverables (deliverable_hash);
CREATE INDEX IF NOT EXISTS idx_deliverable_submit_tx ON agent_job_deliverables (submit_tx_hash);

-- ── Evaluations ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_job_evaluations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                  text NOT NULL,
  evaluator_agent_id      text NOT NULL,
  evaluator_address       text NOT NULL,
  deliverable_hash        text NOT NULL,
  decision                text NOT NULL CHECK (decision IN ('complete', 'reject', 'manual_review')),
  score                   numeric(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
  confidence              numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reason                  text NOT NULL,
  evidence_json           jsonb NOT NULL DEFAULT '[]',
  evaluation_receipt_hash text,
  settlement_tx_hash      text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT uq_evaluation_job UNIQUE (job_id),
  CONSTRAINT ck_evaluation_hash_format CHECK (deliverable_hash ~ '^0x[a-fA-F0-9]{64}$'),
  CONSTRAINT ck_evaluation_evidence_count CHECK (jsonb_array_length(evidence_json) <= 32)
);

CREATE INDEX IF NOT EXISTS idx_evaluation_job ON agent_job_evaluations (job_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_evaluator ON agent_job_evaluations (evaluator_agent_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_decision ON agent_job_evaluations (decision);
CREATE INDEX IF NOT EXISTS idx_evaluation_settlement_tx ON agent_job_evaluations (settlement_tx_hash);

-- ── Reputation Publication Queue ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_reputation_publication (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              text NOT NULL,
  source_agent_id     text NOT NULL,
  target_agent_id     text NOT NULL,
  target_address      text NOT NULL,
  feedback_type       text NOT NULL,
  score               integer NOT NULL,
  tag                 text,
  reason              text,
  evidence_hash       text,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed', 'skipped')),
  attempts            integer NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz,
  tx_hash             text,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT uq_reputation_pub UNIQUE (job_id, source_agent_id, target_agent_id, feedback_type)
);

CREATE INDEX IF NOT EXISTS idx_reputation_pub_status ON agent_reputation_publication (status);
CREATE INDEX IF NOT EXISTS idx_reputation_pub_target ON agent_reputation_publication (target_agent_id);
CREATE INDEX IF NOT EXISTS idx_reputation_pub_next_attempt ON agent_reputation_publication (next_attempt_at) WHERE status = 'pending';
