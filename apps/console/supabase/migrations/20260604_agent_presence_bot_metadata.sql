-- Add optional ERC-8183 bot metadata columns to agent_presence.
-- Nullable, backward compatible, no existing rows affected.

ALTER TABLE agent_presence ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE agent_presence ADD COLUMN IF NOT EXISTS runtime_type text;
ALTER TABLE agent_presence ADD COLUMN IF NOT EXISTS process_name text;
ALTER TABLE agent_presence ADD COLUMN IF NOT EXISTS version text;
ALTER TABLE agent_presence ADD COLUMN IF NOT EXISTS chain_id integer;
ALTER TABLE agent_presence ADD COLUMN IF NOT EXISTS rpc_ok boolean;
