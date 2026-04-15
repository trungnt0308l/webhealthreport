CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  normalized_start_url TEXT NOT NULL,
  base_domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at INTEGER,
  finished_at INTEGER,
  pages_crawled INTEGER DEFAULT 0,
  links_checked INTEGER DEFAULT 0,
  issues_found INTEGER DEFAULT 0,
  current_step TEXT DEFAULT 'Starting scan',
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS crawl_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  url_type TEXT NOT NULL,
  source_url TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  anchor_text TEXT NOT NULL DEFAULT '',
  claimed_at INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (scan_id) REFERENCES scans(id)
);

CREATE INDEX IF NOT EXISTS idx_crawl_queue_scan_status ON crawl_queue(scan_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crawl_queue_unique ON crawl_queue(scan_id, normalized_url);
CREATE INDEX IF NOT EXISTS idx_crawl_queue_bfs ON crawl_queue(scan_id, status, url_type, depth, id);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  status_code INTEGER,
  content_type TEXT,
  title TEXT,
  text_length INTEGER,
  response_ms INTEGER,
  redirect_count INTEGER DEFAULT 0,
  final_url TEXT,
  FOREIGN KEY (scan_id) REFERENCES scans(id)
);

CREATE TABLE IF NOT EXISTS link_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  normalized_target_url TEXT NOT NULL,
  target_type TEXT NOT NULL,
  response_status INTEGER,
  redirect_count INTEGER DEFAULT 0,
  final_url TEXT,
  response_ms INTEGER,
  anchor_text TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (scan_id) REFERENCES scans(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_scan_url ON pages(scan_id, normalized_url);

CREATE INDEX IF NOT EXISTS idx_link_checks_scan ON link_checks(scan_id);
CREATE INDEX IF NOT EXISTS idx_link_checks_scan_id ON link_checks(scan_id, id);
CREATE INDEX IF NOT EXISTS idx_link_checks_scan_target ON link_checks(scan_id, normalized_target_url);

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  affected_count INTEGER DEFAULT 1,
  example_json TEXT,
  target_url TEXT,
  FOREIGN KEY (scan_id) REFERENCES scans(id)
);

CREATE INDEX IF NOT EXISTS idx_issues_scan ON issues(scan_id);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'browser',
  rendered_summary_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (scan_id) REFERENCES scans(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_scan ON reports(scan_id, report_type);

CREATE TABLE IF NOT EXISTS monitored_sites (
  id              TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  base_domain     TEXT NOT NULL,
  emails          TEXT NOT NULL,
  last_scan_id    TEXT REFERENCES scans(id),
  pending_scan_id TEXT REFERENCES scans(id),
  next_scan_at    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  last_scan_status TEXT,
  last_scan_error  TEXT,
  user_id         TEXT
);

-- scans.site_id links a scan back to its monitored site
-- (added in migration 003; not in original schema)
-- ALTER TABLE scans ADD COLUMN site_id TEXT REFERENCES monitored_sites(id);

CREATE INDEX IF NOT EXISTS idx_scans_site_finished
  ON scans(site_id, status, finished_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_monitored_sites_next
  ON monitored_sites (next_scan_at) WHERE pending_scan_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_monitored_sites_user
  ON monitored_sites(user_id) WHERE user_id IS NOT NULL;

