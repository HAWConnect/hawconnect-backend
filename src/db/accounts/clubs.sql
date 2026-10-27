-- Explicit additive migration; never run during server startup.
CREATE TABLE IF NOT EXISTS haw_club_content (
    editor_id text NOT NULL,
    language text NOT NULL CHECK (language IN ('de','en')),
    source_id text,
    source_title text,
    content jsonb NOT NULL,
    version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(editor_id, language),
    CHECK (source_id IS NULL OR editor_id LIKE 'scraped:' || language || ':' || source_id || ':%')
);

-- One-time offline import markers prevent re-importing deleted initial entries.
CREATE TABLE IF NOT EXISTS haw_club_imports (
    import_key text PRIMARY KEY,
    captured_at timestamptz NOT NULL,
    imported_clubs integer NOT NULL,
    kept_clubs integer NOT NULL,
    completed_at timestamptz NOT NULL DEFAULT now()
);
