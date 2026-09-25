CREATE TABLE IF NOT EXISTS listening_sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    catalog_id text NOT NULL,
    queue jsonb NOT NULL,
    current_index integer NOT NULL DEFAULT 0 CHECK (current_index >= 0),
    status text NOT NULL CHECK (status IN ('ready', 'active', 'completed')),
    last_action text CHECK (last_action IN ('skip', 'complete')),
    revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE listening_sessions ADD COLUMN IF NOT EXISTS last_action text CHECK (last_action IN ('skip', 'complete'));
CREATE INDEX IF NOT EXISTS listening_sessions_user_created_idx ON listening_sessions(user_id, created_at DESC);
