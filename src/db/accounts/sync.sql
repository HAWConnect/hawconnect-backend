CREATE TABLE IF NOT EXISTS haw_sync_record (
    user_id text NOT NULL REFERENCES haw_user(id) ON DELETE CASCADE,
    kind text NOT NULL,
    entity_id text NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    deleted boolean NOT NULL DEFAULT false,
    ciphertext text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind, entity_id)
);
CREATE TABLE IF NOT EXISTS haw_sync_receipt (
    user_id text NOT NULL REFERENCES haw_user(id) ON DELETE CASCADE,
    operation_id text NOT NULL,
    request_hash text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, operation_id)
);
