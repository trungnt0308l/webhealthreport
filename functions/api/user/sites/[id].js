import { parseJson } from '../../../_lib/request.js';
/**
 * PATCH  /api/user/sites/:id — update emails for a monitored site owned by the authenticated user
 * DELETE /api/user/sites/:id — remove a monitored site owned by the authenticated user
 *
 * The WHERE user_id = ? clause ensures users cannot modify each other's sites,
 * even if they guess the ID. Returns 404 for both "not found" and "not yours".
 */
import { requireAuth, json } from '../../../_lib/auth.js';
import { corsOptions } from '../../../_lib/response.js';
import { EMAIL_RE } from '../../../_lib/constants.js';
import { deleteMonitoredSite } from '../../../_lib/monitored-sites.js';
import * as paypal from '../../../_lib/paypal.js';
import { withBillingLock, pendingAddition } from '../../../_lib/billing-lock.js';
import { resumeQuantityChange } from '../../../_lib/billing.js';

export const onRequestOptions = ({ request, env }) => corsOptions(request, env, 'DELETE, PATCH, OPTIONS');

export const onRequestPatch = requireAuth(async ({ params, request, env, data }) => {
  let body;
  try { body = await parseJson(request); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const emails = body.emails;
  if (!Array.isArray(emails) || emails.length === 0) return json({ error: 'emails must be a non-empty array' }, 400);
  const invalid = emails.find(e => typeof e !== 'string' || !EMAIL_RE.test(e.trim()));
  if (invalid !== undefined) return json({ error: 'Invalid email: ' + invalid }, 400);

  const { id } = params;
  const result = await env.DB.prepare(
    'UPDATE monitored_sites SET emails = ? WHERE id = ? AND user_id = ?'
  ).bind(JSON.stringify(emails), id, data.user.id).run();

  if (result.meta?.changes === 0) return json({ error: 'Site not found' }, 404);
  return json({ ok: true });
});

export const onRequestDelete = requireAuth(withBillingLock(async ({ params, env, data }) => {
  const { id } = params;
  const userId = data.user.id;
  if (await pendingAddition(env.DB, userId)) return json({ error: 'Complete the pending billing approval before changing sites.' }, 409);
  const changing = await env.DB.prepare('SELECT pending_quantity FROM user_subscriptions WHERE user_id = ?').bind(userId).first();
  if (changing?.pending_quantity != null) return json({ error: 'Complete the pending billing update before changing sites.' }, 409);

  // Ownership is checked inside the atomic writes. Only the request that actually
  // deletes the site may update billing (including concurrent/retried requests).
  if (!await deleteMonitoredSite(env.DB, id, { userId })) {
    return json({ error: 'Site not found' }, 404);
  }

  // Best-effort: update subscription quantity.
  // Failures here (missing table, PayPal error, no subscription) never block deletion.
  try {
    const now = Math.floor(Date.now() / 1000);
    const sub = await env.DB.prepare(
      `SELECT paypal_subscription_id, status, site_count FROM user_subscriptions WHERE user_id = ?`
    ).bind(userId).first();

    if (sub && sub.status === 'active' && sub.site_count > 0) {
      const { n: newCount } = await env.DB.prepare('SELECT COUNT(*) AS n FROM monitored_sites WHERE user_id = ?').bind(userId).first();

      if (newCount === 0) {
        try {
          await paypal.cancelSubscription(env, sub.paypal_subscription_id, 'No monitored sites remaining');
        } catch (err) {
          console.error('Subscription cancellation failed after site deletion', err.code || err.name);
        }
        await env.DB.prepare(
          `UPDATE user_subscriptions SET status = 'cancelled', site_count = 0, updated_at = ?, last_billing_event_at = ? WHERE user_id = ?`
        ).bind(now, Date.now(), userId).run();
      } else {
        await env.DB.prepare(
          `UPDATE user_subscriptions SET site_count = ?, pending_quantity = ?, pending_approval_url = NULL, updated_at = ? WHERE user_id = ?`
        ).bind(newCount, newCount, now, userId).run();
        try { await resumeQuantityChange(env, userId, { ...sub, pending_quantity: newCount, pending_approval_url: null }); }
        catch { /* The persisted billing change remains visible and resumable. */ }
      }
    }
  } catch (err) {
    console.error('Subscription update failed after site deletion', err.code || err.name);
  }

  return json({ ok: true });
}));
