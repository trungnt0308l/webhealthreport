/**
 * GET  /api/monitored-sites?key=<MONITOR_SECRET> — list all monitored sites
 * POST /api/monitored-sites?key=<MONITOR_SECRET> — add a site
 *   Body: { url: string, emails: string[] }
 */
import { normalizeUrl, getBaseDomain } from '../../_lib/crawl.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function authCheck(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!key || !env.MONITOR_SECRET || key !== env.MONITOR_SECRET) {
    return json({ error: 'Access denied' }, 403);
  }
  return null;
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function onRequestGet({ request, env }) {
  const denied = authCheck(request, env);
  if (denied) return denied;

  const result = await env.DB.prepare(
    `SELECT id, url, base_domain, emails, last_scan_id, pending_scan_id, next_scan_at, created_at
     FROM monitored_sites ORDER BY created_at DESC`
  ).all();

  return json({ sites: result.results || [] });
}

export async function onRequestPost({ request, env }) {
  const denied = authCheck(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { url: rawUrl, emails } = body;
  if (!rawUrl) return json({ error: 'url is required' }, 400);
  if (!Array.isArray(emails) || emails.length === 0) return json({ error: 'emails must be a non-empty array' }, 400);

  const invalidEmail = emails.find(e => typeof e !== 'string' || !e.includes('@'));
  if (invalidEmail !== undefined) return json({ error: 'Invalid email address: ' + invalidEmail }, 400);

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
    `INSERT INTO monitored_sites (id, url, base_domain, emails, next_scan_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, startUrl, baseDomain, JSON.stringify(emails), nextScanAt, now).run();

  return json({ id }, 201);
}
