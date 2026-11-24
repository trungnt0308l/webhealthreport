CREATE TABLE billing_locks (
  user_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
ALTER TABLE paypal_pending_orders ADD COLUMN activation_state TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE paypal_pending_orders ADD COLUMN activated_site_id TEXT;
ALTER TABLE paypal_pending_orders ADD COLUMN desired_quantity INTEGER;
ALTER TABLE paypal_pending_orders ADD COLUMN approval_url TEXT;
ALTER TABLE user_subscriptions ADD COLUMN pending_quantity INTEGER;
ALTER TABLE user_subscriptions ADD COLUMN pending_approval_url TEXT;
ALTER TABLE user_subscriptions ADD COLUMN last_billing_event_at INTEGER NOT NULL DEFAULT 0;
