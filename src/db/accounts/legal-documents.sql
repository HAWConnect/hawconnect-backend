BEGIN;
CREATE TABLE IF NOT EXISTS haw_legal_documents (
 document_key text PRIMARY KEY CHECK (document_key IN ('privacy','imprint')),
 draft jsonb NOT NULL,
 published jsonb,
 version text NOT NULL,
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
