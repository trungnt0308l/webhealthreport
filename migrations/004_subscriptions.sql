-- Migration 004: PayPal subscription billing
-- One subscription per user (quantity = site count), paused flag on sites,
-- pending orders table for prorated mid-cycle charges, webhook idempotency,
-- and a failed-captures audit table for support.

CREATE TABLE user_subscriptions (
  user_id                TEXT PRIMARY KEY,
  paypal_subscription_id TEXT NOT NULL UNIQUE,
  status                 TEXT NOT NULL DEFAULT 'active',
  -- 'active' | 'grace_period' | 'suspended' | 'cancelled'
  site_count             INTEGER NOT NULL DEFAULT 0,
  next_billing_date      INTEGER,   -- Unix timestamp of next PayPal charge
  grace_period_ends_at   INTEGER,   -- Unix timestamp; set when payment fails
  payment_failed_at      INTEGER,   -- Unix timestamp of last failure
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL
);

-- Paused flag: sites stop scanning when payment lapses
ALTER TABLE monitored_sites ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_monitored_sites_paused ON monitored_sites(paused);

-- Pending one-time PayPal orders for prorated mid-cycle site additions.
-- site_url and site_emails are stored server-side at creation so capture.js
-- never trusts client-supplied site details.
CREATE TABLE paypal_pending_orders (
  order_id     TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  amount       TEXT NOT NULL,      -- exact decimal string e.g. '8.40'
  sites_to_add INTEGER NOT NULL DEFAULT 1,
  site_url     TEXT NOT NULL,
  site_emails  TEXT NOT NULL,      -- JSON array
  created_at   INTEGER NOT NULL,
  captured_at  INTEGER             -- NULL until captured (double-spend guard)
);
CREATE INDEX idx_paypal_pending_orders_user
  ON paypal_pending_orders(user_id, captured_at, created_at);

-- Webhook idempotency: PayPal retries on 5xx; prevent duplicate processing
CREATE TABLE processed_webhook_events (
  event_id     TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);

-- Support audit: captures that succeeded in PayPal but failed DB writes
CREATE TABLE failed_captures (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  order_id       TEXT,
  paypal_sub_id  TEXT,
  expected_count INTEGER,
  error          TEXT,
  created_at     INTEGER NOT NULL,
  resolved_at    INTEGER           -- set manually by support when resolved
);
