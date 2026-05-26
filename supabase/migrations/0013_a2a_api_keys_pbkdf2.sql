-- Active API key prefix lookup for PBKDF2 verification.
--
-- PBKDF2 hashes use per-key salt, so API keys can no longer be
-- verified by computing key_hash deterministically. The auth layer
-- first loads active candidate rows by key_prefix, then verifies
-- the PBKDF2 hash using the stored salt and timingSafeEqual.
--
-- Also removes UNIQUE constraint from key_hash since the hash
-- format (pbkdf2_v1$...$<salt>$<digest>) includes per-key salt and
-- is unlikely to collide, but uniqueness is now enforced at the
-- application layer via key_prefix + timingSafeEqual verification.

create index if not exists idx_a2a_api_keys_key_prefix_active
  on a2a_api_keys (key_prefix)
  where revoked_at is null;

alter table a2a_api_keys drop constraint if exists a2a_api_keys_key_hash_key;
