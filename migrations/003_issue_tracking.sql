-- Migration 003: Issue tracking — suppression, detection history, scan site linkage

-- 1. Add target_url to issues for cross-scan comparison (fingerprint without scan ID)
ALTER TABLE issues ADD COLUMN target_url TEXT;

-- 2. Backfill target_url from existing example_json
--    Link-based issues store {"target": "..."}, page-based store {"url": "..."}
UPDATE issues
SET target_url = COALESCE(
  json_extract(example_json, '$.target'),
  json_extract(example_json, '$.url')
)
WHERE target_url IS NULL AND example_json IS NOT NULL;

-- 3. Add site_id to scans so reports can find their owning site without a reverse lookup
ALTER TABLE scans ADD COLUMN site_id TEXT REFERENCES monitored_sites(id);

-- 4. Backfill site_id for existing scans using last_scan_id relationship
UPDATE scans SET site_id = (
  SELECT id FROM monitored_sites WHERE last_scan_id = scans.id
) WHERE site_id IS NULL;

-- 5. Index to efficiently find the previous scan for a given site (used in "fixed" diff)
CREATE INDEX IF NOT EXISTS idx_scans_site_finished
  ON scans(site_id, status, finished_at DESC);

-- 6. Suppressed issues: user-declared false positives, per site per issue+URL
CREATE TABLE IF NOT EXISTS suppressed_issues (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id       TEXT    NOT NULL,
  issue_type    TEXT    NOT NULL,
  target_url    TEXT    NOT NULL DEFAULT '',
  suppressed_at INTEGER NOT NULL,
  suppressed_by TEXT,
  FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE,
  UNIQUE (site_id, issue_type, target_url)
);
CREATE INDEX IF NOT EXISTS idx_suppressed_site ON suppressed_issues(site_id);

-- 7. Issue history: tracks when each issue was first detected for a monitored site
--    INSERT OR IGNORE ensures first_detected_at is never overwritten
CREATE TABLE IF NOT EXISTS issue_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id           TEXT    NOT NULL,
  issue_type        TEXT    NOT NULL,
  target_url        TEXT    NOT NULL DEFAULT '',
  first_detected_at INTEGER NOT NULL,
  FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE,
  UNIQUE (site_id, issue_type, target_url)
);
CREATE INDEX IF NOT EXISTS idx_issue_history_site ON issue_history(site_id);
