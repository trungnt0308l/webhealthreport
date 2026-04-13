/**
 * PATCH  /api/user/sites/:id — update emails for a monitored site owned by the authenticated user
 * DELETE /api/user/sites/:id — remove a monitored site owned by the authenticated user
 *
 * The WHERE user_id = ? clause ensures users cannot modify each other's sites,
 * even if they guess the ID. Returns 404 for both "not found" and "not yours".
 */
import { requireAuth, json } from '../../../_lib/auth.js';
import { getAllowedOrigin } from '../../../_lib/cors.js';
import * as paypal from '../../../_lib/paypal.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const onRequestOptions = ({ request, env }) =>
  new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'Access-Control-Allow-Methods': 'DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });

export const onRequestPatch = requireAuth(async ({ params, request, env, data }) => {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

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

export const onRequestDelete = requireAuth(async ({ params, env, data }) => {
  const { id } = params;
  const userId = data.user.id;

  // Verify ownership first
  const site = await env.DB.prepare(
    `SELECT id FROM monitored_sites WHERE id = ? AND user_id = ?`
  ).bind(id, userId).first();
  if (!site) return json({ error: 'Site not found' }, 404);

  // Clear FKs before deleting:
  // 1. scans.site_id references monitored_sites(id) — null it out so the scan
  //    history remains accessible by scan ID but no longer blocks deletion.
  // 2. monitored_sites.pending_scan_id references scans(id) — clear the mutex.
  await env.DB.prepare(
    `UPDATE monitored_sites SET pending_scan_id = NULL WHERE id = ?`
  ).bind(id).run();
  await env.DB.prepare(
    `UPDATE scans SET site_id = NULL WHERE site_id = ?`
  ).bind(id).run();

  await env.DB.prepare(
    `DELETE FROM monitored_sites WHERE id = ? AND user_id = ?`
  ).bind(id, userId).run();

  // Best-effort: update subscription quantity.
  // Failures here (missing table, PayPal error, no subscription) never block deletion.
  try {
    const now = Math.floor(Date.now() / 1000);
    const sub = await env.DB.prepare(
      `SELECT paypal_subscription_id, status, site_count FROM user_subscriptions WHERE user_id = ?`
    ).bind(userId).first();

    if (sub && sub.status === 'active' && sub.site_count > 0) {
      const newCount = sub.site_count - 1;

      if (newCount === 0) {
        try {
          await paypal.cancelSubscription(env, sub.paypal_subscription_id, 'No monitored sites remaining');
        } catch (err) {
          console.error(`PayPal cancel failed for user ${userId}:`, err);
        }
        await env.DB.prepare(
          `UPDATE user_subscriptions SET status = 'cancelled', site_count = 0, updated_at = ? WHERE user_id = ?`
        ).bind(now, userId).run();
      } else {
        try {
          await paypal.reviseSubscription(env, sub.paypal_subscription_id, newCount);
        } catch (err) {
          console.error(`PayPal revise failed for user ${userId}:`, err);
        }
        await env.DB.prepare(
          `UPDATE user_subscriptions SET site_count = ?, updated_at = ? WHERE user_id = ?`
        ).bind(newCount, now, userId).run();
      }
    }
  } catch (err) {
    console.error(`Subscription update failed for user ${userId} after site deletion:`, err);
  }

  return json({ ok: true });
});
