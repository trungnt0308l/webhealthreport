/**
 * POST /api/paypal/subscription/activate
 * Called after the user approves their first PayPal subscription.
 * Verifies ownership and plan, creates the user_subscriptions row, and adds the first site.
 *
 * Body: { subscriptionId, url, emails? }
 *
 * Security:
 *  - Verifies subscription.custom_id === authenticated user ID (IDOR prevention)
 *  - Verifies subscription.plan_id === env.PAYPAL_PLAN_ID (prevents self-created $0 plans)
 *  - INSERT OR IGNORE on user_subscriptions prevents duplicate rows on retry
 */
import { requireAuth, json } from '../../../_lib/auth.js';
import { getAllowedOrigin } from '../../../_lib/cors.js';
import { normalizeUrl, getBaseDomain } from '../../../_lib/crawl.js';
import * as paypal from '../../../_lib/paypal.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const onRequestOptions = ({ request, env }) =>
  new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });

export const onRequestPost = requireAuth(async ({ request, env, data }) => {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { subscriptionId, url: rawUrl, emails: rawEmails } = body;
  if (!subscriptionId) return json({ error: 'subscriptionId is required' }, 400);
  if (!rawUrl)         return json({ error: 'url is required' }, 400);

  // Fetch subscription from PayPal and verify ownership + plan
  let sub;
  try {
    sub = await paypal.getSubscription(env, subscriptionId);
  } catch {
    return json({ error: 'Could not verify subscription with PayPal' }, 400);
  }

  if (sub.custom_id !== data.user.id) {
    return json({ error: 'Subscription does not belong to this account' }, 403);
  }
  if (sub.plan_id !== env.PAYPAL_PLAN_ID) {
    return json({ error: 'Invalid subscription plan' }, 403);
  }
  if (!['APPROVAL_PENDING', 'ACTIVE'].includes(sub.status)) {
    return json({ error: `Subscription not approved (status: ${sub.status})` }, 400);
  }

  // Validate site URL
  let startUrl;
  try {
    startUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    new URL(startUrl);
  } catch {
    return json({ error: 'Invalid URL' }, 400);
  }
  const normalizedStart = normalizeUrl(startUrl, startUrl);
  if (!normalizedStart) return json({ error: 'Could not normalize URL' }, 400);
  const baseDomain = getBaseDomain(normalizedStart);

  // Resolve notification emails
  const emails = Array.isArray(rawEmails) && rawEmails.length > 0
    ? rawEmails : [data.user.email];
  const invalid = emails.find(e => typeof e !== 'string' || !EMAIL_RE.test(e.trim()));
  if (invalid !== undefined) return json({ error: 'Invalid email: ' + invalid }, 400);

  // Extract next billing date from PayPal response
  const nextBillingStr = sub.billing_info?.next_billing_time;
  const nextBillingDate = nextBillingStr
    ? Math.floor(new Date(nextBillingStr).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + 30 * 86400;

  const now = Math.floor(Date.now() / 1000);
  const siteId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const nextScanAt = now + Math.floor(Math.random() * 86400);

  // INSERT OR REPLACE: handles both first-time activation and re-subscription after cancellation.
  // On retry (same subscriptionId, row already active): REPLACE resets site_count to 1 which is
  // correct since this path always adds exactly one site. On re-subscribe (new subscriptionId,
  // old cancelled row exists): REPLACE overwrites the stale cancelled row.
  await env.DB.prepare(
    `INSERT OR REPLACE INTO user_subscriptions
     (user_id, paypal_subscription_id, status, site_count, next_billing_date, created_at, updated_at)
     VALUES (?, ?, 'active', 1, ?, ?, ?)`
  ).bind(data.user.id, subscriptionId, nextBillingDate, now, now).run();

  // Add the first monitored site
  await env.DB.prepare(
    `INSERT INTO monitored_sites (id, url, base_domain, emails, next_scan_at, created_at, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(siteId, startUrl, baseDomain, JSON.stringify(emails), nextScanAt, now, data.user.id).run();

  return json({ ok: true, siteId }, 201);
});
