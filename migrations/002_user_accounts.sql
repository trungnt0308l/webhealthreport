-- Migration 002: Add user_id to monitored_sites for Auth0 user ownership
-- user_id stores Auth0's sub claim (e.g. "auth0|abc123" or "google-oauth2|abc123")
-- Nullable for backward compatibility with existing admin-created sites

ALTER TABLE monitored_sites ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_monitored_sites_user
  ON monitored_sites(user_id) WHERE user_id IS NOT NULL;
