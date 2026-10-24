BEGIN;
CREATE TABLE IF NOT EXISTS haw_organizer_profiles (
 id integer PRIMARY KEY CHECK (id > 0),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 250),
 name_key text NOT NULL UNIQUE,
 description_de text NOT NULL DEFAULT '',
 description_en text NOT NULL DEFAULT '',
 location text,
 website_url text,
 instagram_url text,
 linkedin_url text,
 non_profit boolean,
 registration_number text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
