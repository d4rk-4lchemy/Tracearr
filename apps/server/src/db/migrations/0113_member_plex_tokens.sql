UPDATE "auth_accounts" SET "access_token" = NULL, "refresh_token" = NULL, "access_token_expires_at" = NULL
WHERE "provider_id" = 'plex' AND "user_id" IN (SELECT "id" FROM "users" WHERE "role" <> 'owner');
