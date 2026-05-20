-- A2A trade history table (primary production store for the Pythia→Apollo→Hermes pipeline).
-- The `record` JSONB column stores the full TradeRecord; indexed columns enable fast filtering.

CREATE TABLE IF NOT EXISTS a2a_trades (
  id            TEXT PRIMARY KEY,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_start  BIGINT NOT NULL,
  window_end    BIGINT NOT NULL,
  asset         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING',
  market_slug   TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  record        JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_a2a_trades_asset ON a2a_trades (asset);
CREATE INDEX IF NOT EXISTS idx_a2a_trades_status ON a2a_trades (status);
CREATE INDEX IF NOT EXISTS idx_a2a_trades_window ON a2a_trades (window_start DESC, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_a2a_trades_hash ON a2a_trades (snapshot_hash);

-- Enable RLS (service_role bypasses; anon/authenticated can read only)
ALTER TABLE a2a_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON a2a_trades
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "public_read" ON a2a_trades
  FOR SELECT USING (true);
