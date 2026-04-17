/**
 * POST /api/paypal/webhook
 * Handles PayPal subscription lifecycle events.
 *
 * Security:
 *  - No CORS (PayPal servers, not browser) — verified by PayPal signature only
 *  - Raw body read BEFORE any JSON.parse (required for byte-identical signature verification)
 *  - processed_webhook_events table prevents duplicate processing on PayPal retries
 *  - Webhook handler errors return 200 to prevent retries for our own bugs;
 *    only genuine verification failures return non-200.
 */
import * as paypal from '../../_lib/paypal.js';

export async function onRequestPost(ctx) {
  const { request, env } = ctx;

  // Read raw body FIRST — do NOT call .json() before this
  const rawBody = await request.text();

  // Verify PayPal signature
  let valid = false;
  try {
    valid = await paypal.verifyWebhookSignature(env, request, rawBody);
  } catch (err) {
    console.error('Webhook signature verification error:', err);
  }
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Idempotency: INSERT OR IGNORE; if already processed, return 200 immediately
  const now = Math.floor(Date.now() / 1000);
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO processed_webhook_events (event_id, processed_at) VALUES (?, ?)`
  ).bind(event.id, now).run();

  if (inserted.meta?.changes === 0) {
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const eventType = event.event_type;
  const resource  = event.resource || {};

  try {
    switch (eventType) {

      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        // Webhook may race with activate.js — only update if row already exists
        await env.DB.prepare(
          `UPDATE user_subscriptions SET status = 'active', updated_at = ?
           WHERE paypal_subscription_id = ?`
        ).bind(now, resource.id).run();
        break;
      }

      case 'PAYMENT.SALE.COMPLETED': {
        // Successful monthly renewal — clear grace period, refresh next billing date
        const subId = resource.billing_agreement_id;
        if (!subId) break;

        let nextBillingDate = null;
        try {
          const sub = await paypal.getSubscription(env, subId);
          const nbStr = sub.billing_info?.next_billing_time;
          if (nbStr) nextBillingDate = Math.floor(new Date(nbStr).getTime() / 1000);
        } catch (err) {
          console.error('PayPal webhook: subscription lookup failed', err);
        }

        await env.DB.prepare(
          `UPDATE user_subscriptions
           SET status = 'active',
               grace_period_ends_at = NULL,
               payment_failed_at    = NULL,
               next_billing_date    = COALESCE(?, next_billing_date),
               updated_at           = ?
           WHERE paypal_subscription_id = ?`
        ).bind(nextBillingDate, now, subId).run();

        // Unpause any sites that were paused during a previous grace period
        await env.DB.prepare(
          `UPDATE monitored_sites SET paused = 0
           WHERE paused = 1 AND user_id = (
             SELECT user_id FROM user_subscriptions WHERE paypal_subscription_id = ?
           )`
        ).bind(subId).run();
        break;
      }

      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        const subId = resource.id;
        await env.DB.prepare(
          `UPDATE user_subscriptions
           SET status = 'grace_period',
               grace_period_ends_at = ?,
               payment_failed_at    = ?,
               updated_at           = ?
           WHERE paypal_subscription_id = ?`
        ).bind(now + 3 * 86400, now, now, subId).run();
        break;
      }

      case 'BILLING.SUBSCRIPTION.SUSPENDED': {
        const subId = resource.id;
        await env.DB.prepare(
          `UPDATE user_subscriptions
           SET status = 'suspended',
               grace_period_ends_at = COALESCE(grace_period_ends_at, ?),
               updated_at = ?
           WHERE paypal_subscription_id = ?`
        ).bind(now + 3 * 86400, now, subId).run();
        break;
      }

      case 'BILLING.SUBSCRIPTION.CANCELLED': {
        const subId = resource.id;
        await env.DB.prepare(
          `UPDATE user_subscriptions
           SET status = 'cancelled',
               grace_period_ends_at = COALESCE(grace_period_ends_at, ?),
               updated_at = ?
           WHERE paypal_subscription_id = ?`
        ).bind(now + 3 * 86400, now, subId).run();
        break;
      }

      default:
        // Unknown events are silently ignored
        break;
    }
  } catch (err) {
    // Return 200 so PayPal doesn't retry — this is our bug, not a bad request
    console.error(`Webhook handler error [${eventType}]:`, err);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
