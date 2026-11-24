import { requireAuth, json } from '../../../_lib/auth.js';
import { corsOptions } from '../../../_lib/response.js';
import { parseJson } from '../../../_lib/request.js';
import { getBaseDomain } from '../../../_lib/crawl.js';
import { generateId } from '../../../_lib/constants.js';
import { opaqueId } from '../../../_lib/network.js';
import { withBillingLock, pendingAddition } from '../../../_lib/billing-lock.js';
import * as paypal from '../../../_lib/paypal.js';

export const onRequestOptions = ({ request, env }) => corsOptions(request, env, 'POST, OPTIONS');

export const onRequestPost = requireAuth(withBillingLock(async ({ request, env, data }) => {
  let body;
  try { body = await parseJson(request); opaqueId(body.orderId); } catch { return json({ error: 'Invalid order' }, 400); }
  const userId = data.user.id, orderId = body.orderId;
  const order = await env.DB.prepare('SELECT * FROM paypal_pending_orders WHERE order_id = ? AND user_id = ?').bind(orderId, userId).first();
  if (!order) return json({ error: 'Order not found' }, 404);
  if (order.activation_state === 'complete') return json({ ok: true, siteId: order.activated_site_id });
  if (order.activation_state === 'legacy' && order.captured_at !== null) return json({ error: 'Order already processed' }, 409);
  const pending = await pendingAddition(env.DB, userId);
  if (pending && pending.order_id !== orderId) return json({ error: 'Complete the pending billing approval before adding another site.' }, 409);
  const sub = await env.DB.prepare('SELECT * FROM user_subscriptions WHERE user_id = ?').bind(userId).first();
  if (!sub || sub.status !== 'active' || sub.pending_quantity !== null) return json({ error: 'An active subscription without pending changes is required.' }, 409);
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM monitored_sites WHERE user_id = ?').bind(userId).first();
  const target = order.desired_quantity || n + 1;
  if (target !== n + 1 || target > 20) return json({ error: 'Monitoring inventory changed. Please contact support.' }, 409);
  let provider;
  try { provider = await paypal.getSubscription(env, sub.paypal_subscription_id); }
  catch { return json({ error: 'Could not verify recurring subscription. Please retry.' }, 502); }
  if (provider.status !== 'ACTIVE' || provider.custom_id !== userId || provider.plan_id !== env.PAYPAL_PLAN_ID) return json({ error: 'Subscription could not be verified' }, 409);
  const now = Math.floor(Date.now() / 1000);
  if (order.captured_at === null) {
    let result;
    try { result = await paypal.captureOrder(env, orderId); }
    catch {
      try { result = await paypal.getOrder(env, orderId); }
      catch { return json({ error: 'Payment could not be confirmed. Retry to check the same payment.' }, 502); }
      if (result?.status !== 'COMPLETED') return json({ error: 'Payment could not be confirmed. Retry to check the same payment.' }, 502);
    }
    const capture = result?.purchase_units?.[0]?.payments?.captures?.[0];
    if (result?.status !== 'COMPLETED' || capture?.status !== 'COMPLETED' || capture?.amount?.currency_code !== 'USD' || capture?.amount?.value !== order.amount) {
      return json({ error: 'Payment confirmation mismatch. Please contact support.' }, 422);
    }
    await env.DB.prepare(`UPDATE paypal_pending_orders SET captured_at = ?, desired_quantity = ?, activation_state = 'pending'
      WHERE order_id = ? AND user_id = ?`).bind(now, target, orderId, userId).run();
  }

  // A successful revise response is only a request for buyer consent. Never
  // grant monitoring until a fresh provider read confirms the effective quantity.
  if (Number(provider.quantity || '1') !== target) {
    let approveUrl = order.approval_url;
    if (!approveUrl) {
      try {
        const revision = await paypal.reviseSubscription(env, sub.paypal_subscription_id, target,
          `/account?paypal_capture=1&order_id=${encodeURIComponent(orderId)}`);
        approveUrl = paypal.approvalUrl(revision);
        await env.DB.prepare('UPDATE paypal_pending_orders SET approval_url = ? WHERE order_id = ? AND user_id = ?').bind(approveUrl, orderId, userId).run();
        provider = await paypal.getSubscription(env, sub.paypal_subscription_id);
      } catch { return json({ error: 'Payment received; recurring billing approval is pending. Resume from your account.' }, 502); }
    }
    if (provider.status !== 'ACTIVE' || Number(provider.quantity || '1') !== target) {
      return json({ pendingApproval: true, approveUrl, orderId }, 202);
    }
  }

  const siteId = generateId();
  const [claim] = await env.DB.batch([
    env.DB.prepare(`UPDATE paypal_pending_orders SET activation_state = 'complete', activated_site_id = ?, approval_url = NULL
      WHERE order_id = ? AND user_id = ? AND activation_state = 'pending' AND captured_at IS NOT NULL`)
      .bind(siteId, orderId, userId),
    env.DB.prepare(`INSERT INTO monitored_sites (id, url, base_domain, emails, next_scan_at, created_at, user_id)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(siteId, order.site_url, getBaseDomain(order.site_url), order.site_emails, now, now, userId),
    env.DB.prepare(`UPDATE user_subscriptions SET site_count = ?, updated_at = ? WHERE user_id = ? AND changes() = 1`)
      .bind(target, now, userId),
  ]);
  if (!claim.meta.changes) return json({ error: 'Order already processed' }, 409);
  return json({ ok: true, siteId }, 201);
}));
