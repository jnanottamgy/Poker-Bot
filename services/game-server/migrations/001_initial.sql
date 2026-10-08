-- Johnny's Poker Bot — initial relational schema (PostgreSQL 14+).
--
-- Design notes
-- * Authoritative game state = command logs (table_commands, director_inputs)
--   + periodic snapshots. Every other game table here is a queryable
--   projection written in the same transaction as the command that caused it.
-- * Chips are BIGINT integers; money is BIGINT minor units (e.g. paise).
-- * No table stores "wallet/balance/deposit/withdraw" concepts. Prizes are a
--   fixed structure; payment status is an administrative record only.
-- * Foreign keys everywhere; indexes on tournament/player/table/hand ids and
--   timestamps (spec §62, §138).

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- identities
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Optional cross-tournament identity of a human (players are per-tournament guests by default).
  display_name  TEXT NOT NULL
);

CREATE TABLE admin_users (
  id              TEXT PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','TOURNAMENT_DIRECTOR','STAFF','VIEWER')),
  password_hash   TEXT NOT NULL,
  -- Optional per-tournament scoping: NULL = all tournaments.
  tournament_scope TEXT[] NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT NULL REFERENCES admin_users(id),
  disabled_at     TIMESTAMPTZ NULL,
  last_login_at   TIMESTAMPTZ NULL,
  failed_logins   INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ NULL
);

-- ---------------------------------------------------------------- tournaments
CREATE TABLE tournaments (
  id                  TEXT PRIMARY KEY,
  join_code           TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('DRAFT','REGISTRATION','REGISTRATION_CLOSED','STARTING','RUNNING','BREAK','PAUSED','FINAL_TABLE','COMPLETED','CANCELLED')),
  config              JSONB NOT NULL,
  config_locked_at    TIMESTAMPTZ NULL,
  server_seed_hash    TEXT NOT NULL,
  -- AES-256-GCM encrypted server seed (key from SEED_ENCRYPTION_KEY); revealed only after completion.
  server_seed_enc     TEXT NOT NULL,
  server_seed_revealed TEXT NULL,
  public_entropy      TEXT NULL,
  is_simulation       BOOLEAN NOT NULL DEFAULT FALSE,
  created_by          TEXT NULL REFERENCES admin_users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at          TIMESTAMPTZ NULL,
  completed_at        TIMESTAMPTZ NULL,
  cancelled_at        TIMESTAMPTZ NULL,
  winner_player_id    TEXT NULL,
  -- Aggregated counters maintained incrementally (spec §139) — never COUNT(*) over a million rows per second.
  registered_count    INTEGER NOT NULL DEFAULT 0,
  active_count        INTEGER NOT NULL DEFAULT 0,
  eliminated_count    INTEGER NOT NULL DEFAULT 0,
  table_count         INTEGER NOT NULL DEFAULT 0,
  hands_completed     BIGINT NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tournaments_status_idx ON tournaments (status);
CREATE INDEX tournaments_created_idx ON tournaments (created_at DESC);

CREATE TABLE blind_levels (
  tournament_id     TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  level             INTEGER NOT NULL CHECK (level >= 1),
  small_blind       BIGINT NOT NULL CHECK (small_blind > 0),
  big_blind         BIGINT NOT NULL CHECK (big_blind >= small_blind),
  ante              BIGINT NOT NULL DEFAULT 0 CHECK (ante >= 0),
  duration_seconds  INTEGER NOT NULL CHECK (duration_seconds > 0),
  PRIMARY KEY (tournament_id, level)
);

CREATE TABLE prize_structures (
  tournament_id  TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL CHECK (position >= 1),
  amount_minor   BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency       TEXT NOT NULL,
  label          TEXT NULL,
  locked_at      TIMESTAMPTZ NULL,
  PRIMARY KEY (tournament_id, position)
);

-- ---------------------------------------------------------------- players
-- Personal data lives only here and is never exposed to other players.
CREATE TABLE players (
  id              TEXT PRIMARY KEY,
  tournament_id   TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id         TEXT NULL REFERENCES users(id),
  public_id       TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  nickname        TEXT NULL,
  participant_id  TEXT NULL,
  email           TEXT NULL,
  phone           TEXT NULL,
  college_id      TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, public_id)
);
CREATE INDEX players_tournament_idx ON players (tournament_id);
CREATE INDEX players_name_search_idx ON players (tournament_id, lower(display_name) text_pattern_ops);
CREATE INDEX players_nick_search_idx ON players (tournament_id, lower(nickname) text_pattern_ops);

CREATE TABLE tournament_players (
  entry_id           TEXT PRIMARY KEY,
  tournament_id      TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id          TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  registration_seq   INTEGER NOT NULL,
  entry_number       INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL','REGISTERED','SEATED','IN_TRANSIT','ELIMINATED','SUSPENDED','DISQUALIFIED','WITHDRAWN')),
  client_seed        TEXT NULL,
  registered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at        TIMESTAMPTZ NULL,
  approved_by        TEXT NULL REFERENCES admin_users(id),
  table_id           TEXT NULL,
  seat               INTEGER NULL,
  stack              BIGINT NOT NULL DEFAULT 0 CHECK (stack >= 0),
  hands_played       INTEGER NOT NULL DEFAULT 0,
  largest_pot_won    BIGINT NOT NULL DEFAULT 0,
  finish_position    INTEGER NULL,
  tied_count         INTEGER NOT NULL DEFAULT 1,
  prize_minor        BIGINT NOT NULL DEFAULT 0 CHECK (prize_minor >= 0),
  eliminated_at      TIMESTAMPTZ NULL,
  elimination_hand_id TEXT NULL,
  payment_status     TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID','PROCESSING','PAID')),
  paid_at            TIMESTAMPTZ NULL,
  processed_by       TEXT NULL REFERENCES admin_users(id),
  payment_reference  TEXT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, registration_seq),
  UNIQUE (tournament_id, player_id, entry_number)
);
CREATE INDEX tournament_players_tournament_status_idx ON tournament_players (tournament_id, status);
CREATE INDEX tournament_players_player_idx ON tournament_players (player_id);
CREATE INDEX tournament_players_table_idx ON tournament_players (table_id);
-- Leaderboard by current stack (active players) and by finishing position.
CREATE INDEX tournament_players_stack_idx ON tournament_players (tournament_id, stack DESC) WHERE status IN ('SEATED','IN_TRANSIT','SUSPENDED');
CREATE INDEX tournament_players_finish_idx ON tournament_players (tournament_id, finish_position) WHERE finish_position IS NOT NULL;

-- ---------------------------------------------------------------- sessions
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  -- SHA-256 of the bearer token; the raw token is never stored.
  token_hash      TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL CHECK (kind IN ('PLAYER','ADMIN','SPECTATOR')),
  player_id       TEXT NULL REFERENCES players(id) ON DELETE CASCADE,
  admin_id        TEXT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  tournament_id   TEXT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  csrf_token_hash TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ NULL,
  revoked_reason  TEXT NULL,
  user_agent      TEXT NULL,
  ip              TEXT NULL,
  CHECK ((kind = 'PLAYER' AND player_id IS NOT NULL) OR (kind = 'ADMIN' AND admin_id IS NOT NULL) OR kind = 'SPECTATOR')
);
CREATE INDEX sessions_player_idx ON sessions (player_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_admin_idx ON sessions (admin_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------- tables & seats
CREATE TABLE tables (
  id                 TEXT PRIMARY KEY,
  tournament_id      TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  table_number       INTEGER NOT NULL,
  max_seats          INTEGER NOT NULL CHECK (max_seats BETWEEN 2 AND 10),
  status             TEXT NOT NULL,
  is_final_table     BOOLEAN NOT NULL DEFAULT FALSE,
  player_count       INTEGER NOT NULL DEFAULT 0,
  hands_played       INTEGER NOT NULL DEFAULT 0,
  last_event_seq     BIGINT NOT NULL DEFAULT 0,
  last_command_seq   BIGINT NOT NULL DEFAULT 0,
  last_progress_at   TIMESTAMPTZ NULL,
  -- Actor ownership lease for multi-node deployments (fencing via lease_epoch).
  owner_node         TEXT NULL,
  lease_epoch        BIGINT NOT NULL DEFAULT 0,
  lease_expires_at   TIMESTAMPTZ NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at          TIMESTAMPTZ NULL,
  UNIQUE (tournament_id, table_number)
);
CREATE INDEX tables_tournament_status_idx ON tables (tournament_id, status);

-- Current seat projection (authoritative seat state lives in the table actor's state).
CREATE TABLE seats (
  table_id     TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  seat_index   INTEGER NOT NULL CHECK (seat_index >= 0),
  player_id    TEXT NULL REFERENCES players(id),
  stack        BIGINT NOT NULL DEFAULT 0 CHECK (stack >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, seat_index)
);
CREATE UNIQUE INDEX seats_player_unique_idx ON seats (player_id) WHERE player_id IS NOT NULL;

-- ---------------------------------------------------------------- event sourcing
-- Command log: replaying these through the pure reducers reproduces the exact state.
CREATE TABLE table_commands (
  table_id     TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  seq          BIGINT NOT NULL,
  command_id   TEXT NOT NULL,
  at           BIGINT NOT NULL,
  type         TEXT NOT NULL,
  command      JSONB NOT NULL,
  -- Idempotency: one row per client actionId per table (spec §29).
  action_id    TEXT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, seq),
  UNIQUE (table_id, command_id)
);
CREATE UNIQUE INDEX table_commands_action_idx ON table_commands (table_id, action_id) WHERE action_id IS NOT NULL;

CREATE TABLE table_events (
  table_id     TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  seq          BIGINT NOT NULL,
  version      BIGINT NOT NULL,
  at           BIGINT NOT NULL,
  kind         TEXT NOT NULL,
  visibility   TEXT NOT NULL CHECK (visibility IN ('PUBLIC','PRIVATE')),
  private_to   TEXT NULL,
  payload      JSONB NOT NULL,
  PRIMARY KEY (table_id, seq)
);
CREATE INDEX table_events_kind_idx ON table_events (table_id, kind);

CREATE TABLE table_snapshots (
  table_id     TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  command_seq  BIGINT NOT NULL,
  version      BIGINT NOT NULL,
  at           BIGINT NOT NULL,
  state        JSONB NOT NULL,
  PRIMARY KEY (table_id, command_seq)
);

CREATE TABLE director_inputs (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  seq           BIGINT NOT NULL,
  at            BIGINT NOT NULL,
  type          TEXT NOT NULL,
  input         JSONB NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, seq)
);

CREATE TABLE director_snapshots (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  input_seq     BIGINT NOT NULL,
  at            BIGINT NOT NULL,
  state         JSONB NOT NULL,
  PRIMARY KEY (tournament_id, input_seq)
);

CREATE TABLE tournament_events (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  seq           BIGINT NOT NULL,
  at            BIGINT NOT NULL,
  kind          TEXT NOT NULL,
  payload       JSONB NOT NULL,
  PRIMARY KEY (tournament_id, seq)
);
CREATE INDEX tournament_events_kind_idx ON tournament_events (tournament_id, kind, seq DESC);

-- ---------------------------------------------------------------- hand history (projection)
CREATE TABLE hands (
  id              TEXT PRIMARY KEY,
  tournament_id   TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  table_id        TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  hand_number     INTEGER NOT NULL,
  started_at      BIGINT NOT NULL,
  completed_at    BIGINT NULL,
  button_seat     INTEGER NULL,
  small_blind_seat INTEGER NULL,
  big_blind_seat  INTEGER NOT NULL,
  level           INTEGER NOT NULL,
  small_blind     BIGINT NOT NULL,
  big_blind       BIGINT NOT NULL,
  ante            BIGINT NOT NULL DEFAULT 0,
  board           TEXT[] NOT NULL DEFAULT '{}',
  total_pot       BIGINT NOT NULL DEFAULT 0,
  deck_hash       TEXT NOT NULL,
  -- Randomness metadata needed for independent verification (spec §58, §60).
  randomness      JSONB NOT NULL,
  -- Complete hand record (actions, pots, showdown) for replay.
  history         JSONB NOT NULL,
  UNIQUE (table_id, hand_number)
);
CREATE INDEX hands_tournament_idx ON hands (tournament_id, completed_at DESC);
CREATE INDEX hands_table_idx ON hands (table_id, hand_number DESC);

CREATE TABLE hand_players (
  hand_id         TEXT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
  player_id       TEXT NOT NULL REFERENCES players(id),
  seat            INTEGER NOT NULL,
  starting_stack  BIGINT NOT NULL,
  final_stack     BIGINT NOT NULL,
  -- Private: visible only to admins with VIEW_HOLE_CARDS / HAND_HISTORY_VIEW.
  hole_cards      TEXT[] NULL,
  showed_cards    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (hand_id, player_id)
);
CREATE INDEX hand_players_player_idx ON hand_players (player_id);

CREATE TABLE actions (
  hand_id      TEXT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  player_id    TEXT NOT NULL REFERENCES players(id),
  seat         INTEGER NOT NULL,
  street       TEXT NOT NULL CHECK (street IN ('PREFLOP','FLOP','TURN','RIVER')),
  action       TEXT NOT NULL,
  amount       BIGINT NOT NULL CHECK (amount >= 0),
  to_amount    BIGINT NOT NULL CHECK (to_amount >= 0),
  all_in       BOOLEAN NOT NULL,
  timeout      BOOLEAN NOT NULL DEFAULT FALSE,
  at           BIGINT NOT NULL,
  PRIMARY KEY (hand_id, seq)
);
CREATE INDEX actions_player_idx ON actions (player_id);

CREATE TABLE pots (
  hand_id         TEXT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
  pot_index       INTEGER NOT NULL,
  pot_type        TEXT NOT NULL CHECK (pot_type IN ('MAIN','SIDE')),
  amount          BIGINT NOT NULL CHECK (amount >= 0),
  eligible_seats  INTEGER[] NOT NULL,
  PRIMARY KEY (hand_id, pot_index)
);
CREATE VIEW side_pots AS SELECT * FROM pots WHERE pot_type = 'SIDE';

CREATE TABLE pot_winners (
  hand_id      TEXT NOT NULL,
  pot_index    INTEGER NOT NULL,
  player_id    TEXT NOT NULL REFERENCES players(id),
  amount       BIGINT NOT NULL CHECK (amount >= 0),
  odd_chips    BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (hand_id, pot_index, player_id),
  FOREIGN KEY (hand_id, pot_index) REFERENCES pots(hand_id, pot_index) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- tournament outcomes
CREATE TABLE eliminations (
  tournament_id    TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  entry_id         TEXT NOT NULL REFERENCES tournament_players(entry_id) ON DELETE CASCADE,
  player_id        TEXT NOT NULL REFERENCES players(id),
  finish_position  INTEGER NOT NULL CHECK (finish_position >= 1),
  tied_count       INTEGER NOT NULL DEFAULT 1,
  eliminated_at    BIGINT NOT NULL,
  hand_id          TEXT NULL,
  hand_number      INTEGER NULL,
  table_id         TEXT NULL,
  batch_id         TEXT NOT NULL,
  starting_stack_of_hand BIGINT NOT NULL DEFAULT 0,
  reason           TEXT NOT NULL DEFAULT 'BUSTED' CHECK (reason IN ('BUSTED','DISQUALIFIED')),
  PRIMARY KEY (tournament_id, entry_id)
);
CREATE INDEX eliminations_position_idx ON eliminations (tournament_id, finish_position);

CREATE TABLE player_movements (
  id               TEXT PRIMARY KEY,
  tournament_id    TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id        TEXT NOT NULL REFERENCES players(id),
  reason           TEXT NOT NULL,
  from_table_id    TEXT NULL,
  from_seat        INTEGER NULL,
  to_table_id      TEXT NOT NULL,
  to_seat          INTEGER NOT NULL,
  stack            BIGINT NOT NULL,
  requested_at     BIGINT NOT NULL,
  completed_at     BIGINT NULL,
  score_breakdown  JSONB NULL
);
CREATE INDEX player_movements_player_idx ON player_movements (player_id, requested_at DESC);
CREATE INDEX player_movements_tournament_idx ON player_movements (tournament_id, requested_at DESC);

-- ---------------------------------------------------------------- audit & alerts
-- Append-only, hash-chained (each row hashes the previous row's hash).
CREATE TABLE audit_logs (
  id              TEXT PRIMARY KEY,
  seq             BIGSERIAL UNIQUE,
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  tournament_id   TEXT NULL REFERENCES tournaments(id) ON DELETE SET NULL,
  admin_id        TEXT NULL REFERENCES admin_users(id),
  admin_username  TEXT NOT NULL,
  action          TEXT NOT NULL,
  target          TEXT NOT NULL,
  reason          TEXT NULL,
  before_state    JSONB NULL,
  after_state     JSONB NULL,
  ip              TEXT NULL,
  prev_hash       TEXT NOT NULL,
  hash            TEXT NOT NULL
);
CREATE INDEX audit_logs_tournament_idx ON audit_logs (tournament_id, at DESC);
CREATE INDEX audit_logs_admin_idx ON audit_logs (admin_id, at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, at DESC);

-- Audit rows can never be updated or deleted by the application role.
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TABLE alerts (
  id               TEXT PRIMARY KEY,
  at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  tournament_id    TEXT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  severity         TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  code             TEXT NOT NULL,
  message          TEXT NOT NULL,
  target           TEXT NULL,
  acknowledged_by  TEXT NULL REFERENCES admin_users(id),
  acknowledged_at  TIMESTAMPTZ NULL,
  resolved_at      TIMESTAMPTZ NULL
);
CREATE INDEX alerts_open_idx ON alerts (tournament_id, at DESC) WHERE resolved_at IS NULL;
