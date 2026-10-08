-- Registration numbers get their own counter. They used to be taken from
-- registered_count, which the director projection also writes (with its own,
-- briefly lagging count): under concurrent registrations the counter moved
-- backwards and handed out duplicate numbers.
ALTER TABLE tournaments ADD COLUMN next_registration_seq INTEGER NOT NULL DEFAULT 0;
UPDATE tournaments t
   SET next_registration_seq = COALESCE((SELECT max(registration_seq) FROM tournament_players p WHERE p.tournament_id = t.id), 0);
