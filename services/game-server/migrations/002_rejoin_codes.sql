-- Rejoin codes let a player recover their seat on a new device/browser
-- (spec §8-9). Stored as a slow scrypt hash; attempts are rate-limited.
ALTER TABLE players ADD COLUMN rejoin_code_hash TEXT NULL;
ALTER TABLE players ADD COLUMN rejoin_code_issued_at TIMESTAMPTZ NULL;
