-- Migration 005: Report lead capture
-- Stores email addresses collected via "Email me this report" on the report page.
-- Used as a marketing lead list for following up with non-authenticated users.

CREATE TABLE report_leads (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL REFERENCES scans(id),
  email   TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);

CREATE INDEX idx_report_leads_email ON report_leads(email);
