import * as paypal from '../../_lib/paypal.js';
import { readLimited, opaqueId } from '../../_lib/network.js';
import { json } from '../../_lib/auth.js';
import { withBillingLock } from '../../_lib/billing-lock.js';

const stateEvents = new Set(['BILLING.SUBSCRIPTION.ACTIVATED', 'PAYMENT.SALE.COMPLETED', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.CANCELLED']);

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  let bytes;
  try { bytes = await readLimited(request, 128 * 1024, AbortSignal.timeout(5000)); }
  catch { return json({ error: 'Invalid webhook body' }, 413); }
  let valid;
  try { valid = await paypal.verifyWebhookSignature(env, request, bytes); }
  catch (error) { console.error('Webhook verifier unavailable', error.code || error.name); return json({ error: 'Signature verification unavailable' }, 503); }
  if (!valid) return json({ error: 'Invalid signature' }, 401);
  let event;
  try { event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return json({ error: 'Invalid event' }, 400); }
  if (!event || typeof event.id !== 'string' || !event.id || event.id.length > 200 || typeof event.event_type !== 'string') return json({ error: 'Invalid event' }, 400);
  let id = null, eventTime = 0;
  if (stateEvents.has(event.event_type)) {
    try { id = opaqueId(event.event_type === 'PAYMENT.SALE.COMPLETED' ? event.resource?.billing_agreement_id : event.resource?.id); }
    catch { return json({ error: 'Invalid event' }, 400); }
    eventTime = Date.parse(event.create_time);
    if (!Number.isFinite(eventTime) || eventTime > Date.now() + 300000) return json({ error: 'Invalid event time' }, 400);
  }
  const subscription = id ? await env.DB.prepare('SELECT user_id FROM user_subscriptions WHERE paypal_subscription_id = ?').bind(id).first() : null;
  const apply = () => applyEvent(env, event, id, eventTime);
  if (!subscription) return apply();
  return withBillingLock(apply, 503)({ ...ctx, data: { user: { id: subscription.user_id } } });
}

async function applyEvent(env, event, id, eventTime) {
  const now = Math.floor(Date.now() / 1000);
  const unseen = ' AND NOT EXISTS (SELECT 1 FROM processed_webhook_events WHERE event_id = ?)';
  const statements = [];
  const update = (sql, values) => statements.push(env.DB.prepare(sql + ' AND last_billing_event_at <= ?' + unseen).bind(...values, eventTime, event.id));
  try {
    let state = null, nextBilling = null;
    if (['BILLING.SUBSCRIPTION.ACTIVATED', 'PAYMENT.SALE.COMPLETED'].includes(event.event_type)) {
      const provider = await paypal.getSubscription(env, id);
      const inventory = await env.DB.prepare('SELECT site_count FROM user_subscriptions WHERE paypal_subscription_id = ?').bind(id).first();
      if (provider.status === 'ACTIVE') {
        state = Number(provider.quantity || '1') >= (inventory?.site_count || 0) ? 'active' : 'suspended';
        if (Number(provider.billing_info?.outstanding_balance?.value || 0) > 0) state = 'grace_period';
      } else if (['CANCELLED', 'SUSPENDED'].includes(provider.status)) state = provider.status.toLowerCase();
      const date = Date.parse(provider.billing_info?.next_billing_time);
      nextBilling = Number.isFinite(date) ? Math.floor(date / 1000) : null;
    } else if (event.event_type === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') state = 'grace_period';
    else if (event.event_type === 'BILLING.SUBSCRIPTION.SUSPENDED') state = 'suspended';
    else if (event.event_type === 'BILLING.SUBSCRIPTION.CANCELLED') state = 'cancelled';

    if (state === 'active') {
      update(`UPDATE user_subscriptions SET status = 'active', grace_period_ends_at = NULL,
        payment_failed_at = NULL, next_billing_date = COALESCE(?, next_billing_date), updated_at = ?, last_billing_event_at = ?
        WHERE paypal_subscription_id = ?`, [nextBilling, now, eventTime, id]);
      statements.push(env.DB.prepare(`UPDATE monitored_sites SET paused = 0 WHERE user_id IN
        (SELECT user_id FROM user_subscriptions WHERE paypal_subscription_id = ? AND status = 'active' AND last_billing_event_at = ?)` + unseen)
        .bind(id, eventTime, event.id));
    } else if (state) {
      update(`UPDATE user_subscriptions SET status = ?, grace_period_ends_at = COALESCE(grace_period_ends_at, ?),
        payment_failed_at = CASE WHEN ? = 'grace_period' THEN COALESCE(payment_failed_at, ?) ELSE payment_failed_at END,
        pending_quantity = CASE WHEN ? = 'cancelled' THEN NULL ELSE pending_quantity END,
        pending_approval_url = CASE WHEN ? = 'cancelled' THEN NULL ELSE pending_approval_url END,
        updated_at = ?, last_billing_event_at = ? WHERE paypal_subscription_id = ?`,
      [state, now + 3 * 86400, state, now, state, state, now, eventTime, id]);
    }
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO processed_webhook_events (event_id, processed_at) VALUES (?, ?)').bind(event.id, now));
    await env.DB.batch(statements);
  } catch { return json({ error: 'Webhook processing unavailable' }, 503); }
  return json({ ok: true });
}
