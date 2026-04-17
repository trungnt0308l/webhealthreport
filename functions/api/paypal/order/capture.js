/**
 * POST /api/paypal/order/capture
 * Captures an approved PayPal order, adds the monitored site, and increments
 * the subscription quantity for the next renewal.
 *
 * Body: { orderId }
 * Site details (url, emails) come from paypal_pending_orders — never from client body.
 *
 * Security:
 *  - Atomic double-spend guard: UPDATE ... WHERE captured_at IS NULL
 *  - Amount verification: captured amount must match stored expected amount
 *  - Operations ordered: capture money → revise subscription → write site to DB
 *    (failed_captures table logs partial failures for support resolution)
 */
import { requireAuth, json } from '../../../_lib/auth.js';
import { corsOptions } from '../../../_lib/response.js';
import { getBaseDomain } from '../../../_lib/crawl.js';
import { generateId } from '../../../_lib/constants.js';
import * as paypal from '../../../_lib/paypal.js';

export const onRequestOptions = ({ request, env }) => corsOptions(request, env, 'POST, OPTIONS');

export const onRequestPost = requireAuth(async ({ request, env, data }) => {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { orderId } = body;
  if (!orderId) return json({ error: 'orderId is required' }, 400);

  const userId = data.user.id;
  const now    = Math.floor(Date.now() / 1000);

  // Atomic double-spend guard: mark captured_at in a single UPDATE.
  // If two requests arrive simultaneously, only one will get changes=1.
  const markResult = await env.DB.prepare(
    `UPDATE paypal_pending_orders SET captured_at = ?
     WHERE order_id = ? AND user_id = ? AND captured_at IS NULL
     RETURNING order_id, amount, site_url, site_emails`
  ).bind(now, orderId, userId).first();

  if (!markResult) {
    // Not found, wrong user, or already captured
    return json({ error: 'Order not found or already processed' }, 409);
  }

  const { amount: expectedAmount, site_url: startUrl, site_emails: emailsJson } = markResult;

  // ── Step 1: Capture money from PayPal ──────────────────────────────────────
  let captureResult;
  try {
    captureResult = await paypal.captureOrder(env, orderId);
  } catch (err) {
    // Rollback the double-spend guard so user can retry
    await env.DB.prepare(
      `UPDATE paypal_pending_orders SET captured_at = NULL WHERE order_id = ?`
    ).bind(orderId).run();
    return json({ error: 'Payment capture failed. Please try again.' }, 502);
  }

  // Verify captured amount matches what we stored (fraud check)
  const capturedAmount = captureResult
    ?.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value;
  if (capturedAmount !== expectedAmount) {
    const failId = generateId();
    await env.DB.prepare(
      `INSERT INTO failed_captures (id, user_id, order_id, error, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(failId, userId, orderId,
      `Amount mismatch: expected ${expectedAmount}, captured ${capturedAmount}`, now).run();
    return json({ error: 'Payment amount mismatch — please contact support' }, 422);
  }

  // ── Step 2: Atomically increment site_count ─────────────────────────────────
  const subResult = await env.DB.prepare(
    `UPDATE user_subscriptions
     SET site_count = site_count + 1, updated_at = ?
     WHERE user_id = ? AND status = 'active'
     RETURNING site_count, paypal_subscription_id`
  ).bind(now, userId).first();

  if (!subResult) {
    // Subscription gone between order creation and capture — very unlikely
    const failId = generateId();
    await env.DB.prepare(
      `INSERT INTO failed_captures (id, user_id, order_id, error, created_at)
       VALUES (?, ?, ?, 'No active subscription at capture time', ?)`
    ).bind(failId, userId, orderId, now).run();
    return json({ error: 'Subscription not found — please contact support' }, 500);
  }

  const { site_count: newCount, paypal_subscription_id: subId } = subResult;

  // ── Step 3: Revise PayPal subscription quantity (best-effort) ──────────────
  try {
    await paypal.reviseSubscription(env, subId, newCount);
  } catch (err) {
    // Log for manual reconciliation but don't fail — user already paid
    const failId = generateId();
    await env.DB.prepare(
      `INSERT INTO failed_captures (id, user_id, order_id, paypal_sub_id, expected_count, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(failId, userId, orderId, subId, newCount, `Revise failed: ${err.message}`, now).run();
    console.error(`Subscription revise failed for user ${userId}:`, err);
    // Continue — site will still be added
  }

  // ── Step 4: Add the monitored site ─────────────────────────────────────────
  const emails     = JSON.parse(emailsJson);
  const baseDomain = getBaseDomain(startUrl);
  const siteId     = generateId();
  const nextScanAt = now + Math.floor(Math.random() * 86400);

  await env.DB.prepare(
    `INSERT INTO monitored_sites (id, url, base_domain, emails, next_scan_at, created_at, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(siteId, startUrl, baseDomain, JSON.stringify(emails), nextScanAt, now, userId).run();

  return json({ ok: true, siteId }, 201);
});
