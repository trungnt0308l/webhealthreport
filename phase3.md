# PayPal Subscription Billing Plan

## Context

The app currently allows registered users to add unlimited monitored sites for free. We need to monetize with PayPal at **$9/month per site** (shown as ~~$19~~ to incentivize early sign-ups). The goal is to minimize PayPal transaction fees by using one consolidated subscription per user where quantity = number of sites, billed together in one monthly charge.

**Chosen strategy:**
- One PayPal subscription per user (quantity-based, not per-site subscriptions)
- Payment wall before adding a site: modal → PayPal approval → site added
- 3-day grace period on payment failure, 30-day deletion window
- Sites paused (not deleted) on non-payment; resume on re-subscription

---

## Architecture Overview

### PayPal Setup (one-time, manual in PayPal Developer Dashboard)
1. Create a **Product**: "Website Health Monitoring"
2. Create a **Plan**: `FIXED` at $9.00/unit/month, with `quantity_supported: true`
   - Store the resulting `Plan ID` as env var `PAYPAL_PLAN_ID`
3. Configure webhook: point to `https://webhealthreport.pages.dev/api/paypal/webhook`
   - Events: `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.CANCELLED`, `PAYMENT.SALE.COMPLETED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
   - Store the `Webhook ID` as `PAYPAL_WEBHOOK_ID`

### Subscription flow for first site
1. User clicks "Add Site" → system checks for active subscription → none found
2. Modal opens showing ~~$19~~ **$9/month** pricing + PayPal button
3. PayPal JS SDK calls `createSubscription` (frontend POSTs to `/api/paypal/subscription/create`)
4. Backend creates PayPal subscription with `quantity=1`, returns `subscriptionID`
5. User approves in PayPal popup → `onApprove` fires
6. Frontend POSTs `subscriptionID` to `/api/paypal/subscription/activate`
7. Backend saves to `user_subscriptions` table → site is added to `monitored_sites`

### Subscription flow for subsequent sites (pro-rating)
PayPal's Revise API does NOT automatically prorate mid-cycle additions. We handle this with a **hybrid** model: a separate one-time PayPal Order for the prorated amount, plus a subscription revision for future renewals.

1. User clicks "Add Site" → system checks subscription → active, `site_count = N`
2. Backend calls `GET /api/user/subscription` to determine:
   - `next_billing_date` (stored from PayPal webhook or subscription fetch)
   - `days_remaining` = days until next billing date
   - `days_in_cycle` = 30
   - `prorated_amount` = `$9.00 × (days_remaining / days_in_cycle)`, rounded up to cents
3. UI shows the "Add Site" form **plus** a notice: *"Prorated charge for this billing period: $X.XX"*
4. A **PayPal Order button** (one-time payment, not subscription) is shown for `prorated_amount`
5. User approves → PayPal captures the one-time order
6. Backend:
   - Calls PayPal Revise API: `quantity = N+1` (takes effect next renewal)
   - Inserts site into `monitored_sites`
   - Updates `user_subscriptions SET site_count = N+1`
7. Next renewal: `$9 × (N+1)` charged by PayPal subscription as normal

**Edge case — adding multiple sites at once:** Pro-rate is calculated per site and summed into a single PayPal Order (`prorated_amount = $9 × new_site_count × days_remaining / days_in_cycle`). One PayPal fee covers the whole batch.

**Why not bill-at-next-cycle?** A user adding 10 sites on Day 2 would get ~$84 of free monitoring. With per-site pro-rating, they pay $84 immediately — the correct amount.

### Subscription flow when removing a site
1. User deletes a site → backend calls PayPal Revise API to decrease `quantity = N-1`
2. If `quantity` drops to 0: cancel subscription entirely

---

## Database Changes

**New file: `migrations/005_subscriptions.sql`**
```sql
CREATE TABLE user_subscriptions (
  user_id                TEXT PRIMARY KEY,
  paypal_subscription_id TEXT NOT NULL UNIQUE,
  status                 TEXT NOT NULL DEFAULT 'active',
  -- 'active' | 'grace_period' | 'suspended' | 'cancelled'
  site_count             INTEGER NOT NULL DEFAULT 0,
  grace_period_ends_at   INTEGER,   -- Unix timestamp; set when payment fails
  payment_failed_at      INTEGER,   -- Unix timestamp of last failure
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL
);

ALTER TABLE monitored_sites ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_monitored_sites_paused ON monitored_sites(paused);

CREATE TABLE paypal_pending_orders (
  order_id     TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  amount       TEXT NOT NULL,        -- exact decimal string e.g. '8.40'
  sites_to_add INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  captured_at  INTEGER               -- NULL until successfully captured (double-spend guard)
);

CREATE TABLE processed_webhook_events (
  event_id     TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);

-- Support tool: captures that succeeded in PayPal but failed to write to D1
CREATE TABLE failed_captures (
  id                TEXT PRIMARY KEY,   -- random ID
  user_id           TEXT NOT NULL,
  order_id          TEXT,
  paypal_sub_id     TEXT,
  expected_count    INTEGER,
  error             TEXT,
  created_at        INTEGER NOT NULL,
  resolved_at       INTEGER             -- set manually by support
);
```

---

## New Files to Create

### `functions/_lib/paypal.js`
PayPal REST API client using `fetch()` (no Node SDK — Cloudflare Workers compatible):
- `getAccessToken(env)` — OAuth2 with client_id:secret, cached for 8h via D1
- `createSubscription(env, userId, quantity)` — POST to PayPal subscriptions, returns `{id, links}`
- `reviseSubscription(env, subscriptionId, quantity)` — POST to `/revise` endpoint
- `cancelSubscription(env, subscriptionId)` — POST to `/cancel` endpoint
- `getSubscription(env, subscriptionId)` — GET subscription details (includes `billing_info.next_billing_time`)
- `createOrder(env, amount)` — POST one-time Order for prorated mid-cycle charge
- `captureOrder(env, orderId)` — POST to capture approved Order
- `verifyWebhookSignature(env, headers, body)` — verify PayPal webhook authenticity

### `functions/api/paypal/subscription/index.js`
- `GET` → `requireAuth` → get user's subscription from `user_subscriptions` table (includes `next_billing_date`, `site_count`, `status`)
- `POST` → `requireAuth` → call `paypal.createSubscription(env, userId, quantity=1)` → return PayPal approval URL
- `DELETE` → `requireAuth` → call `paypal.cancelSubscription` → update `user_subscriptions.status = 'cancelled'`

### `functions/api/paypal/subscription/activate.js`
- `POST` → `requireAuth` → receives `{ subscriptionId, url, emails }` in body
- Verify subscription is `APPROVAL_PENDING` or `ACTIVE` via `paypal.getSubscription()`
- Store `next_billing_date` from PayPal response into `user_subscriptions`
- Insert into `user_subscriptions` (user_id, paypal_subscription_id, status='active', site_count=1)
- Insert the first site into `monitored_sites`
- Return the new site object

### `functions/api/paypal/order/create.js`
- `POST` → `requireAuth` → receives `{ site_count_to_add }` in body
- Reads user subscription: `next_billing_date`, `days_in_cycle`
- Calculates: `prorated_amount = 9.00 × site_count_to_add × (days_remaining / days_in_cycle)`, min $0.01
- Creates PayPal one-time Order via `paypal.createOrder(env, prorated_amount)`
- Returns `{ orderId, prorated_amount }` to frontend

### `functions/api/paypal/order/capture.js`
- `POST` → `requireAuth` → receives `{ orderId, url, emails }` in body
- Captures the PayPal order via `paypal.captureOrder(env, orderId)`
- Calls PayPal Revise API: `quantity = current_site_count + 1`
- Inserts site into `monitored_sites`
- Updates `user_subscriptions SET site_count = site_count + 1`

### `functions/api/paypal/webhook.js`
No auth required (verified by PayPal signature):
- Verify signature via `paypal.verifyWebhookSignature()`
- Handle events:
  - `BILLING.SUBSCRIPTION.ACTIVATED` → upsert subscription as active
  - `PAYMENT.SALE.COMPLETED` → clear `grace_period_ends_at`, set status='active'
  - `BILLING.SUBSCRIPTION.PAYMENT.FAILED` → set `grace_period_ends_at = now + 3 days`, status='grace_period'
  - `BILLING.SUBSCRIPTION.SUSPENDED` → set status='suspended', trigger grace
  - `BILLING.SUBSCRIPTION.CANCELLED` → set status='cancelled', trigger grace

---

## Modified Files

### `functions/api/user/sites/index.js`
**On POST (add site):**
1. `requireAuth` (existing)
2. **NEW**: Query `user_subscriptions WHERE user_id = ?`
3. If no subscription or status not in ('active', 'grace_period'): return `402 Payment Required` with `{ error: 'subscription_required' }`
4. If subscription exists and not first site: call `paypal.reviseSubscription(env, subId, site_count + 1)`
5. Insert site into `monitored_sites` (existing logic)
6. Update `user_subscriptions SET site_count = site_count + 1`

**Note:** First site is created via `activate.js` (after PayPal approval), so `index.js` POST only handles site 2+.

### `functions/api/user/sites/[id].js`
**On DELETE:**
1. Existing ownership check
2. **NEW**: Get current `site_count` from `user_subscriptions`
3. If `site_count - 1 === 0`: call `paypal.cancelSubscription()` → update status='cancelled'
4. Else: call `paypal.reviseSubscription(env, subId, site_count - 1)` → update `site_count`
5. Delete from `monitored_sites` (existing)

### `scheduler/index.js`
**Add grace period enforcement cron** (run every 6 hours):
```
SELECT user_id FROM user_subscriptions
WHERE grace_period_ends_at IS NOT NULL AND grace_period_ends_at < unixepoch()
AND status = 'grace_period'
```
- Pause all monitored_sites for these users: `UPDATE monitored_sites SET paused = 1 WHERE user_id = ?`
- Update `user_subscriptions SET status = 'suspended'`
- For users with `payment_failed_at < now - 30 days`: delete their sites and subscriptions

**Modify scheduled scan launcher** (existing cron):
- Add `AND paused = 0` to the site query so paused sites are skipped

### `src/lib/api.js`
Add:
- `getSubscription(token)` → `GET /api/paypal/subscription`
- `cancelSubscription(token)` → `DELETE /api/paypal/subscription`
- `activateSite(token, subscriptionId, url, emails)` → `POST /api/paypal/subscription/activate`

### `src/pages/Account.jsx`
**New: Subscription status card** (above sites table):
- If active: "Plan: $9/site/month · N sites · Next billing: [date] · [Cancel subscription]"
- If grace_period: "⚠️ Payment failed — sites pausing in X days · [Update Payment]"
- If no subscription: "Start monitoring for $9/month per site (~~$19~~)"

**Modified: "Add Site" button behavior:**
- If no active subscription: opens `<SubscriptionModal>` with PayPal JS SDK
- If subscribed: opens existing add-site form directly

**New: `<SubscriptionModal>` component (inside Account.jsx):**
- Shows pricing: ~~$19~~ **$9**/month per site
- Bullet points: weekly scans, email alerts, issue history
- PayPal SDK `Buttons` component with `vault: true` for subscription
- `createSubscription` → POST `/api/paypal/subscription` → return subscriptionID
- `onApprove(data)` → POST `/api/paypal/subscription/activate` with subscriptionID + site details
- On success: close modal, refresh sites list

**Sites table: show "Paused" badge** when `site.paused` is true (new field returned from API).

### `src/lib/api.js` — `getUserSites` return type
The GET user/sites response needs to include `paused` column — add to SELECT in `functions/api/user/sites/index.js`.

---

## Environment Variables Required

**wrangler.toml (backend secrets via `wrangler secret put`):**
- `PAYPAL_CLIENT_ID` — from PayPal Developer App
- `PAYPAL_CLIENT_SECRET` — from PayPal Developer App
- `PAYPAL_PLAN_ID` — the $9/unit/month plan created in PayPal
- `PAYPAL_WEBHOOK_ID` — from PayPal webhook configuration

**Frontend (.env.local + Cloudflare Pages env):**
- `VITE_PAYPAL_CLIENT_ID` — same as backend client ID (public, for JS SDK)

---

## Critical Files

| File | Change |
|------|--------|
| `migrations/005_subscriptions.sql` | New — user_subscriptions, paypal_pending_orders, processed_webhook_events, paused column |
| `functions/_lib/paypal.js` | New — PayPal REST client (subscription + order) |
| `functions/api/paypal/subscription/index.js` | New — GET/POST/DELETE subscription |
| `functions/api/paypal/subscription/activate.js` | New — activate first site after subscription approval |
| `functions/api/paypal/order/create.js` | New — create prorated one-time Order for site 2+ |
| `functions/api/paypal/order/capture.js` | New — capture Order, add site, revise subscription |
| `functions/api/paypal/webhook.js` | New — webhook handler |
| `functions/api/user/sites/index.js` | Modified — check subscription, block free adds |
| `functions/api/user/sites/[id].js` | Modified — reduce subscription quantity on delete |
| `scheduler/index.js` | Modified — skip paused sites; add grace period cron |
| `src/pages/Account.jsx` | Modified — subscription card, PayPal modal, pro-rate notice |
| `src/lib/api.js` | Modified — subscription + order API calls |

---

## Security Hardening

### 1. IDOR on `activate.js` — subscription ownership verification
**Risk:** Malicious user submits another user's `subscriptionId`, claiming a subscription that isn't theirs.
**Fix:** Set `custom_id = user_id` (Auth0 sub) in the PayPal `createSubscription` payload. In `activate.js`, after fetching the subscription from PayPal, assert `subscription.custom_id === ctx.data.user.id` AND `subscription.plan_id === env.PAYPAL_PLAN_ID` (prevents submitting a $0 self-created PayPal plan). Reject 403 on any mismatch.

### 2. Unbound order IDs — any PayPal order could be submitted to `capture.js`
**Risk:** Client sends an orderId created outside our system (e.g., $0.01 order) to get a site added for free.
**Fix:** `order/create.js` stores the order in `paypal_pending_orders` (see schema). `capture.js` looks up by `orderId` WHERE `user_id = authenticated user` — rejects 404 if not found. After PayPal capture, verifies returned capture amount matches stored `amount` string exactly. Rejects with 422 if mismatch (log as suspected fraud).

### 3. Double-capture prevention (atomic)
**Risk:** `capture.js` called twice simultaneously with same orderId → two sites added, subscription quantity doubled.
**Fix:** Atomic update: `UPDATE paypal_pending_orders SET captured_at = unixepoch() WHERE order_id = ? AND user_id = ? AND captured_at IS NULL`. Check rows_affected === 1. If 0 → return 409 Conflict. D1 guarantees this is atomic.

### 4. Webhook: raw body required for PayPal signature verification
**Risk:** Reading body as JSON first (common mistake) corrupts the byte-identical string PayPal signed — signature always fails, leaving webhook unverified.
**Fix:** In `webhook.js`, read body with `await request.text()` (NOT `.json()`). Pass raw string to `verifyWebhookSignature()`, then parse with `JSON.parse()` after verification passes.

### 5. Webhook CORS bypass — PayPal servers have no matching Origin
**Risk:** The existing `validateCors()` middleware rejects requests without a matching `Origin` header. PayPal webhooks come from PayPal's IPs with no browser Origin.
**Fix:** `webhook.js` exports a standalone `onRequestPost` that skips CORS entirely — relies solely on `verifyWebhookSignature()` for trust.

### 6. Webhook idempotency — PayPal retries on 5xx
**Risk:** PayPal retries a webhook if our handler returns 5xx. Processing `PAYMENT.SALE.COMPLETED` twice could reset grace period twice, or worse, double-activate a subscription.
**Fix:** `processed_webhook_events` table (see schema). At top of webhook handler: `INSERT OR IGNORE INTO processed_webhook_events ... RETURNING event_id`. If no row returned (already processed) → return 200 immediately, no processing.

### 7. Webhook race: `BILLING.SUBSCRIPTION.ACTIVATED` may arrive before `activate.js`
**Risk:** PayPal fires the webhook immediately on user approval. Our frontend calls `activate.js` slightly later. Webhook handler tries to update a row that doesn't exist yet.
**Fix:** Webhook handler for `ACTIVATED` uses `UPDATE user_subscriptions SET status='active', updated_at=? WHERE paypal_subscription_id = ?` — does nothing if row doesn't exist yet (correct). `activate.js` is the authoritative creator of the row and site. Webhooks only mutate existing rows.

### 8. Duplicate subscription creation
**Risk:** User calls `POST /api/paypal/subscription` multiple times before approving any, creating orphaned PayPal subscriptions that might charge them.
**Fix:** Before creating a new PayPal subscription, check `user_subscriptions WHERE user_id = ?`. If a row exists with `paypal_subscription_id` and status is not `cancelled`, verify its current state via `paypal.getSubscription()`. If still APPROVAL_PENDING, return the existing approval URL. If ACTIVE, return 409. Only create new subscription if genuinely no active one exists.

### 9. Race condition on `site_count` (concurrent site additions)
**Risk:** Two simultaneous "Add Site" requests both read `site_count = 1` → both revise PayPal to `quantity = 2` → but two sites are added.
**Fix:** In `capture.js`, atomically increment `site_count` in D1 FIRST: `UPDATE user_subscriptions SET site_count = site_count + 1 WHERE user_id = ? RETURNING site_count`. Use the returned new count as the PayPal revision target. If two concurrent requests do this, they get sequential counts. Then do the PayPal revise call. If PayPal fails, decrement back with `site_count = site_count - 1`.

### 10. PayPal operation failure after DB commit (partial state)
**Risk:** D1 insert of `monitored_sites` succeeds, but PayPal `reviseSubscription` fails → site was added without updating the subscription quantity → underbilling.
**Fix:** Sequence must be: (1) capture PayPal order first — money is committed, (2) revise PayPal subscription quantity, (3) then write to D1. If step 3 fails, log to `failed_captures` table with `user_id`, `subscription_id`, `expected_site_count`, `timestamp` for support resolution. Never leave money taken without service delivered.

### 11. Validate `site_count_to_add` in `order/create.js`
**Risk:** Client sends `site_count_to_add = 0` → prorated_amount = $0 → order created for $0 → free site. Or `site_count_to_add = -1` → negative charge.
**Fix:** Validate server-side: `site_count_to_add` must be an integer ≥ 1. Also cap at a reasonable max (e.g., 10 at once) to prevent abuse.

### 12. Pending order accumulation
**Risk:** User repeatedly calls `order/create.js` without capturing → fills `paypal_pending_orders` table.
**Fix:** Before creating a new order, check for uncaptured orders for this user: `SELECT count(*) FROM paypal_pending_orders WHERE user_id = ? AND captured_at IS NULL AND created_at > unixepoch() - 3600`. If ≥ 3 pending orders in the last hour → return 429. Also: cron job to delete orders older than 24h with `captured_at IS NULL`.

### 13. PayPal token caching — store in Worker memory, not D1
**Risk:** Storing OAuth access tokens in D1 is slower and exposes tokens if DB is read. Tokens in D1 also survive across deployments when they may be stale.
**Fix:** Cache in `globalThis._paypalToken = { token, expiresAt }` in the Worker. Falls back to fresh fetch if missing (Worker restarts) or expired. No D1 read needed for most requests.

### 14. Sandbox vs production credential separation
**Risk:** Production credentials accidentally used in dev, or sandbox credentials deployed to production.
**Fix:** Add `PAYPAL_BASE_URL` as a non-secret env var: `https://api-m.sandbox.paypal.com` in dev/wrangler.toml dev env, `https://api-m.paypal.com` in production Cloudflare Pages. All PayPal API calls in `paypal.js` use this URL. Fail fast if env var missing.

### 15. Clarify site creation routing (no ambiguous paths)
`user/sites/index.js POST` acts as safety net — checks subscription, returns 402 if none. It is NOT called for paid adds. `order/capture.js` writes directly to `monitored_sites` via D1. The distinction is documented in code comments to prevent future confusion.

---

## Verification

1. **Happy path (PayPal sandbox):**
   - Create sandbox buyer + business accounts
   - Set `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com` in dev
   - Click "Add Site" → modal appears with ~~$19~~ $9 pricing
   - Approve in PayPal popup → site appears, subscription row in DB
   - Add second site → pro-rate notice shows correct amount → order approved → site added
   - Delete a site → subscription quantity drops → DB reflects new count
   - Delete last site → subscription cancelled in PayPal → DB status = 'cancelled'

2. **Security attack tests:**
   - Submit a foreign `subscriptionId` to `activate.js` → expect 403 (custom_id mismatch)
   - Submit a self-created PayPal subscription with wrong plan_id → expect 403
   - Submit a fabricated `orderId` (not in `paypal_pending_orders`) to `capture.js` → expect 404
   - Call `capture.js` twice with same orderId → second call returns 409
   - Call `order/create.js` with `site_count_to_add = 0` → expect 400
   - Call `order/create.js` > 3 times without capturing → expect 429 on 4th call

3. **Webhook tests (PayPal Sandbox webhook simulator):**
   - Send `BILLING.SUBSCRIPTION.PAYMENT.FAILED` → verify `grace_period_ends_at` set to now + 3 days
   - Send same event again (idempotency test) → no second DB write
   - Send `PAYMENT.SALE.COMPLETED` → verify grace cleared, status = 'active'
   - Tamper with webhook body before sending → expect signature rejection

4. **Grace period + pause:**
   - Manually set `grace_period_ends_at = unixepoch() - 1` in D1
   - Run the grace period cron manually → verify sites set to `paused=1`, subscription status = 'suspended'
   - Verify cron scan launcher skips paused sites
   - Re-subscribe → verify sites unpaused

5. **Reconciliation check:** Add a site, manually decrement `site_count` in D1, run weekly reconciliation → verify alert or correction logged
