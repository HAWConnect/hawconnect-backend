CREATE TABLE IF NOT EXISTS haw_quick_links (
 id integer PRIMARY KEY CHECK (id=1),
 links jsonb NOT NULL,
 version text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
