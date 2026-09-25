CREATE TABLE IF NOT EXISTS listening_sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    catalog_id text NOT NULL,
    queue jsonb NOT NULL,
    current_index integer NOT NULL DEFAULT 0 CHECK (current_index >= 0),
    status text NOT NULL CHECK (status IN ('ready', 'active', 'completed')),
    last_action text CHECK (last_action IN ('skip', 'complete')),
    target_mood jsonb,
    taste_input jsonb NOT NULL DEFAULT '{"preferredGenres":[],"likedTrackIds":[]}'::jsonb,
    last_check_in jsonb,
    retention_days integer NOT NULL DEFAULT 30 CHECK (retention_days IN (1, 7, 30)),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
    revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE listening_sessions ADD COLUMN IF NOT EXISTS last_action text CHECK (last_action IN ('skip', 'complete'));
ALTER TABLE listening_sessions ADD COLUMN IF NOT EXISTS target_mood jsonb;
ALTER TABLE listening_sessions ADD COLUMN IF NOT EXISTS taste_input jsonb NOT NULL DEFAULT '{"preferredGenres":[],"likedTrackIds":[]}'::jsonb;
ALTER TABLE listening_sessions ADD COLUMN IF NOT EXISTS last_check_in jsonb;
ALTER TABLE listening_sessions ADD COLUMN IF NOT EXISTS retention_days integer NOT NULL DEFAULT 30;
ALTER TABLE listening_sessions ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days');
CREATE INDEX IF NOT EXISTS listening_sessions_user_created_idx ON listening_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS listening_sessions_expires_idx ON listening_sessions(expires_at);
CREATE TABLE IF NOT EXISTS session_events (
    session_id text NOT NULL REFERENCES listening_sessions(id) ON DELETE CASCADE,
    event_id text NOT NULL,
    track_id text NOT NULL,
    event_type text NOT NULL CHECK (event_type IN ('start','skip','complete','replay','like')),
    payload jsonb NOT NULL,
    result jsonb NOT NULL,
    accepted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(session_id,event_id)
);
CREATE INDEX IF NOT EXISTS session_events_order_idx ON session_events(session_id,accepted_at,event_id);
CREATE TABLE IF NOT EXISTS session_check_ins (
    id text PRIMARY KEY,
    session_id text NOT NULL REFERENCES listening_sessions(id) ON DELETE CASCADE,
    mood jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS session_check_ins_order_idx ON session_check_ins(session_id,created_at);
