-- Durable inter-actor messaging (transactional outbox). Rows are written in
-- the same transaction as the command that produced them (director -> table
-- commands, table -> director reports) and delivered strictly in `id` order
-- per (source, target) by the node that owns the source actor. Receivers
-- deduplicate by the per-sender sequence carried in each message, so a
-- re-delivery after a crash is harmless and nothing is ever lost.
CREATE TABLE actor_outbox (
  id            BIGSERIAL PRIMARY KEY,
  source_kind   TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  target_kind   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  payload       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT NULL
);
CREATE INDEX actor_outbox_source_idx ON actor_outbox (source_kind, source_id, id);

-- Hand history projection: enough columns for fast browsing and the full record for replay.
ALTER TABLE hands ADD COLUMN showdown BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE hands ADD COLUMN all_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE hands ADD COLUMN table_number INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hands ADD COLUMN player_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX hands_pot_idx ON hands (tournament_id, total_pot DESC);
