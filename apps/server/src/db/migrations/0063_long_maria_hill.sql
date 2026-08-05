-- Login usernames become case-insensitively unique below (usernames were
-- normalized in 0061). Colliding login-capable accounts are renamed first:
-- the owner (or the oldest account) keeps the name, every other account gets
-- a suffix from its own id. Sessions, email, Plex, and OIDC logins never key
-- on username, so a rename only affects username+password login on the
-- renamed account itself; the known collision shape is a duplicate row of
-- the same person minted by an early release, where the kept row is the one
-- that person logs in with. display_username (backfilled in 0061) keeps the
-- familiar display form. Suffix math fits varchar(100): 91 + 1 + 8.
UPDATE users u
SET username = left(u.username, 91) || '-' || left(u.id::text, 8)
FROM (
  SELECT id,
         row_number() OVER (
           PARTITION BY lower(username)
           ORDER BY (role = 'owner') DESC, created_at ASC, id
         ) AS rn
  FROM users
  WHERE role IN ('owner', 'admin', 'viewer')
) ranked
WHERE u.id = ranked.id AND ranked.rn > 1;
--> statement-breakpoint
-- Backstop for collisions the rename cannot resolve (a rename target that is
-- itself already taken): fail with a remediation message instead of a raw
-- unique-violation from the index build.
DO $$
DECLARE
  conflict record;
  details text := '';
BEGIN
  FOR conflict IN
    SELECT lower(username) AS login_name,
           string_agg(username || ' (' || role || ', id ' || id || ')', ', ' ORDER BY created_at) AS accounts
    FROM users
    WHERE role IN ('owner', 'admin', 'viewer')
    GROUP BY lower(username)
    HAVING count(*) > 1
  LOOP
    details := details || E'\n  ' || conflict.login_name || ': ' || conflict.accounts;
  END LOOP;
  IF details <> '' THEN
    RAISE EXCEPTION USING
      message = 'Tracearr upgrade blocked: multiple login-capable users share the same username (case-insensitive):' || details,
      hint = 'Give each listed account a distinct username, then re-run migrations. Example: UPDATE users SET username = ''newname'' WHERE id = ''<id>'';';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_login_username_unique" ON "users" USING btree (lower("username")) WHERE role IN ('owner', 'admin', 'viewer');
