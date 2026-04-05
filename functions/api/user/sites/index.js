/**
 * GET  /api/user/sites — list the authenticated user's monitored sites
 * POST /api/user/sites — add a new monitored site for the authenticated user
 *   Body: { url: string, emails?: string[] }
 */
import { requireAuth, json } from '../../../_lib/auth.js';
import { normalizeUrl, getBaseDomain } from '../../../_lib/crawl.js';

export const onRequestOptions = () =>
  new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });

export const onRequestGet = requireAuth(async ({ env, data }) => {
  const result = await env.DB.prepare(
    `SELECT id, url, base_domain, emails, last_scan_id, pending_scan_id,
            next_scan_at, created_at, last_scan_status, last_scan_error
     FROM monitored_sites
     WHERE user_id = ?
     ORDER BY created_at DESC`
  ).bind(data.user.id).all();

  return json({ sites: result.results || [] });
});

export const onRequestPost = requireAuth(async ({ request, env, data }) => {
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

  const invalidEmail = emails.find(e => typeof e !== 'string' || !e.includes('@'));
  if (invalidEmail !== undefined) {
    return json({ error: 'Invalid email address: ' + invalidEmail }, 400);
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
  // Random spread within next 7 days — prevents all sites scanning simultaneously
  const nextScanAt = now + Math.floor(Math.random() * 604800);

  await env.DB.prepare(
    `INSERT INTO monitored_sites (id, url, base_domain, emails, next_scan_at, created_at, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, startUrl, baseDomain, JSON.stringify(emails), nextScanAt, now, data.user.id).run();

  return json({ id }, 201);
});
