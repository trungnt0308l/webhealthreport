-- Preserve report privacy even when site deletion detaches the foreign key.
ALTER TABLE scans ADD COLUMN access_scope TEXT NOT NULL DEFAULT 'restricted';
ALTER TABLE scans ADD COLUMN access_owner_id TEXT;
UPDATE scans SET access_owner_id = (
  SELECT user_id FROM monitored_sites WHERE monitored_sites.id = scans.site_id
) WHERE site_id IS NOT NULL;
-- Historical detached scans cannot reliably be distinguished from one-off scans.
-- They remain admin-only. Newly created one-off scans explicitly opt into public access.

CREATE TABLE request_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE subscription_activations (
  subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
