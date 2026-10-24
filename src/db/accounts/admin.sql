-- Additive dashboard permissions; campus content remains in existing tables.
CREATE TABLE IF NOT EXISTS haw_admin_roles (
 email text PRIMARY KEY CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@haw-hamburg\.de$'),
 capabilities text[] NOT NULL DEFAULT '{}',
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (capabilities <@ ARRAY['announcements','events','ops','audit','admin']::text[])
);
