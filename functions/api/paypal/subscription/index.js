/**
 * GET    /api/paypal/subscription — authenticated user's subscription status
 * POST   /api/paypal/subscription — create a PayPal subscription (first site flow)
 * DELETE /api/paypal/subscription — cancel subscription (starts 3-day grace period)
 */
import { requireAuth, json } from '../../../_lib/auth.js';
import { corsOptions } from '../../../_lib/response.js';
import * as paypal from '../../../_lib/paypal.js';
import { withBillingLock, pendingAddition } from '../../../_lib/billing-lock.js';
import { resumeQuantityChange } from '../../../_lib/billing.js';

export const onRequestOptions = ({ request, env }) => corsOptions(request, env, 'GET, POST, DELETE, OPTIONS');

export const onRequestGet = requireAuth(async ({ env, data }) => {
  const sub = await env.DB.prepare(
    `SELECT paypal_subscription_id, status, site_count, next_billing_date,
            grace_period_ends_at, payment_failed_at, created_at, pending_quantity, pending_approval_url
     FROM user_subscriptions WHERE user_id = ?`
  ).bind(data.user.id).first();

  const pendingOrder = await pendingAddition(env.DB, data.user.id);
  return json({ subscription: sub || null, pendingOrder: pendingOrder?.order_id || null });
});

export const onRequestPost = requireAuth(withBillingLock(async ({ request, env, data }) => {
  const userId = data.user.id;

  // Guard: don't create a duplicate if one already exists
  const existing = await env.DB.prepare(
    `SELECT * FROM user_subscriptions WHERE user_id = ?`
  ).bind(userId).first();
  if (existing?.pending_quantity !== null && existing?.pending_quantity !== undefined) {
    try { return json(await resumeQuantityChange(env, userId, existing)); }
    catch { return json({ error: 'Billing update remains pending. Please retry.' }, 502); }
  }

  if (existing && existing.status !== 'cancelled') {
    try {
      const sub = await paypal.getSubscription(env, existing.paypal_subscription_id);
      if (sub.status === 'APPROVAL_PENDING') {
        // User never finished approving — return the existing approval URL
        const link = sub.links?.find(l => l.rel === 'approve');
        return json({ subscriptionId: existing.paypal_subscription_id, approveUrl: link?.href });
      }
      if (sub.status === 'ACTIVE') {
        return json({ error: 'You already have an active subscription' }, 409);
      }
    } catch { return json({ error: 'Could not verify the existing subscription' }, 502); }
  }

  const retained = await env.DB.prepare('SELECT id FROM monitored_sites WHERE user_id = ? LIMIT 1').bind(userId).first();
  if (retained) return json({ error: 'Remove retained monitoring sites before starting a new subscription.' }, 409);

  const origin = new URL(request.url).origin;
  const returnUrl = `${origin}/account?paypal_sub=activated`;
  const cancelUrl = `${origin}/account?paypal_sub=cancelled`;

  const sub = await paypal.createSubscription(env, userId, 1, returnUrl, cancelUrl);
  const link = sub.links?.find(l => l.rel === 'approve');

  return json({ subscriptionId: sub.id, approveUrl: link?.href });
}));

export const onRequestDelete = requireAuth(withBillingLock(async ({ env, data }) => {
  const userId = data.user.id;
  const sub = await env.DB.prepare(
    `SELECT paypal_subscription_id, status FROM user_subscriptions WHERE user_id = ?`
  ).bind(userId).first();

  if (!sub) return json({ error: 'No subscription found' }, 404);
  if (sub.status === 'cancelled') return json({ ok: true });
  if (await pendingAddition(env.DB, userId)) return json({ error: 'Complete the pending billing approval before changing the subscription.' }, 409);

  await paypal.cancelSubscription(env, sub.paypal_subscription_id);

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE user_subscriptions
     SET status = 'cancelled', grace_period_ends_at = COALESCE(grace_period_ends_at, ?), updated_at = ?, last_billing_event_at = ?,
         pending_quantity = NULL, pending_approval_url = NULL
     WHERE user_id = ?`
  ).bind(now + 3 * 86400, now, Date.now(), userId).run();

  return json({ ok: true });
}));
