-- Explicit additive migration for voluntary club-office presence.
CREATE TABLE IF NOT EXISTS haw_member_office (
 user_id text PRIMARY KEY REFERENCES haw_memberships(user_id) ON DELETE CASCADE,
 checked_in_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now() + interval '12 hours')
);
