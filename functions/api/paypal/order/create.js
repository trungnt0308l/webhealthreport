/**
 * POST /api/paypal/order/create
 * Creates a one-time PayPal order for the prorated mid-cycle charge when adding
 * a site to an existing subscription.
 *
 * Body: { url, emails? }
 *
 * Returns: { orderId, proratedAmount, daysRemaining, approveUrl }
 *
 * Security:
 *  - Requires active subscription (not grace_period — prevents adding sites while owing money)
 *  - Validates site_count_to_add server-side (client never controls the amount)
 *  - Stores order in paypal_pending_orders with server-computed amount
 *  - Rate-limits to 3 uncaptured orders per hour to prevent table flooding
 */
import { requireAuth, json } from '../../../_lib/auth.js';
import { getAllowedOrigin } from '../../../_lib/cors.js';
import { normalizeUrl } from '../../../_lib/crawl.js';
import * as paypal from '../../../_lib/paypal.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PRICE_PER_SITE = 9.00;
const DAYS_IN_CYCLE  = 30;

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

  const { url: rawUrl, emails: rawEmails } = body;
  if (!rawUrl) return json({ error: 'url is required' }, 400);

  // Must have an active subscription — grace_period users must fix payment first
  const sub = await env.DB.prepare(
    `SELECT paypal_subscription_id, status, site_count, next_billing_date
     FROM user_subscriptions WHERE user_id = ?`
  ).bind(data.user.id).first();

  if (!sub || sub.status !== 'active') {
    return json({ error: 'An active subscription is required to add more sites' }, 402);
  }

  // Rate-limit: max 3 uncaptured orders created in the last hour
  const { pending } = await env.DB.prepare(
    `SELECT COUNT(*) as pending FROM paypal_pending_orders
     WHERE user_id = ? AND captured_at IS NULL AND created_at > ?`
  ).bind(data.user.id, Math.floor(Date.now() / 1000) - 3600).first();
  if (pending >= 3) {
    return json({ error: 'Too many pending payments. Complete or cancel a pending payment first.' }, 429);
  }

  // Validate site URL
  let startUrl;
  try {
    startUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    new URL(startUrl);
  } catch {
    return json({ error: 'Invalid URL' }, 400);
  }
  if (!normalizeUrl(startUrl, startUrl)) return json({ error: 'Could not normalize URL' }, 400);

  // Validate emails
  const emails = Array.isArray(rawEmails) && rawEmails.length > 0
    ? rawEmails : [data.user.email];
  const invalid = emails.find(e => typeof e !== 'string' || !EMAIL_RE.test(e.trim()));
  if (invalid !== undefined) return json({ error: 'Invalid email: ' + invalid }, 400);

  // Calculate prorated amount server-side — never trust the client for this
  const now = Math.floor(Date.now() / 1000);
  const nextBilling = sub.next_billing_date || (now + DAYS_IN_CYCLE * 86400);
  const daysRemaining = Math.max(1, Math.ceil((nextBilling - now) / 86400));
  const ratio = Math.min(daysRemaining / DAYS_IN_CYCLE, 1);
  const proratedAmount = Math.max(0.01, Math.ceil(PRICE_PER_SITE * ratio * 100) / 100).toFixed(2);

  // Create the PayPal order
  const origin = new URL(request.url).origin;
  // PayPal appends ?token=ORDER_ID to the return_url after approval
  const returnUrl = `${origin}/account?paypal_capture=1`;
  const cancelUrl = `${origin}/account?paypal_cancelled=1`;

  const order = await paypal.createOrder(env, proratedAmount, returnUrl, cancelUrl);
  const approveLink = order.links?.find(l => l.rel === 'approve' || l.rel === 'payer-action');

  // Store order with server-computed amount and site details
  // (capture.js reads from here — never from client request body)
  await env.DB.prepare(
    `INSERT INTO paypal_pending_orders
     (order_id, user_id, amount, sites_to_add, site_url, site_emails, created_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)`
  ).bind(order.id, data.user.id, proratedAmount, startUrl, JSON.stringify(emails), now).run();

  return json({ orderId: order.id, proratedAmount, daysRemaining, approveUrl: approveLink?.href });
});
