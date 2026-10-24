-- Membership records only: no admin permissions or upstream identity tokens.
-- Applied explicitly by a maintainer; never run automatically on startup.
CREATE TABLE IF NOT EXISTS haw_memberships (
 user_id text PRIMARY KEY REFERENCES haw_user(id) ON DELETE CASCADE,
 granted_at timestamptz NOT NULL DEFAULT now()
);
