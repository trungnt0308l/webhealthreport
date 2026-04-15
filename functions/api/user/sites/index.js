/**
 * GET  /api/user/sites — list the authenticated user's monitored sites
 * POST /api/user/sites — add a new monitored site for the authenticated user
 *   Body: { url: string, emails?: string[] }
 */
import { requireAuth, json } from '../../../_lib/auth.js';
import { normalizeUrl, getBaseDomain } from '../../../_lib/crawl.js';
import { getAllowedOrigin } from '../../../_lib/cors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_SITES_PER_USER = 20;

export const onRequestOptions = ({ request, env }) =>
  new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });

export const onRequestGet = requireAuth(async ({ env, data }) => {
  const result = await env.DB.prepare(
    `SELECT ms.id, ms.url, ms.base_domain, ms.emails, ms.last_scan_id, ms.pending_scan_id,
            ms.next_scan_at, ms.created_at, ms.last_scan_status, ms.last_scan_error, ms.paused,
            s.finished_at AS last_scan_at
     FROM monitored_sites ms
     LEFT JOIN scans s ON s.id = ms.last_scan_id
     WHERE ms.user_id = ?
     ORDER BY ms.created_at DESC`
  ).bind(data.user.id).all();

  return json({ sites: result.results || [] });
});

export const onRequestPost = requireAuth(async ({ request, env, data }) => {
  // All paid site additions go through /api/paypal/order/capture (subsequent sites)
  // or /api/paypal/subscription/activate (first site). This endpoint is a safety net
  // that blocks direct access without a valid subscription.
  const sub = await env.DB.prepare(
    `SELECT status FROM user_subscriptions WHERE user_id = ?`
  ).bind(data.user.id).first();
  if (!sub || sub.status !== 'active') {
    return json({ error: 'subscription_required', message: 'An active subscription is required.' }, 402);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { url: rawUrl, emails: rawEmails } = body;
  if (!rawUrl) return json({ error: 'url is required' }, 400);

  // Default notification email to the user's own address
  const emails = Array.isArray(rawEmails) && rawEmails.length > 0
    ? rawEmails
    : [data.user.email];

  if (!data.user.email && emails.length === 0) {
    return json({ error: 'emails is required (no email address on account)' }, 400);
  }

  const invalidEmail = emails.find(e => typeof e !== 'string' || !EMAIL_RE.test(e.trim()));
  if (invalidEmail !== undefined) {
    return json({ error: 'Invalid email address: ' + invalidEmail }, 400);
  }

  // Per-user site cap
  const { n } = await env.DB.prepare(
    'SELECT COUNT(*) as n FROM monitored_sites WHERE user_id = ?'
  ).bind(data.user.id).first();
  if (n >= MAX_SITES_PER_USER) {
    return json({ error: `Maximum ${MAX_SITES_PER_USER} monitored sites per account.` }, 400);
  }

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
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = Math.floor(Date.now() / 1000);
  // Random spread within next 24 hours for first scan — prevents all new sites scanning simultaneously
  const nextScanAt = now + Math.floor(Math.random() * 86400);

  await env.DB.prepare(
    `INSERT INTO monitored_sites (id, url, base_domain, emails, next_scan_at, created_at, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, startUrl, baseDomain, JSON.stringify(emails), nextScanAt, now, data.user.id).run();

  return json({ id }, 201);
});
