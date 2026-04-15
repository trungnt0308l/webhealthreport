/**
 * GET  /api/monitored-sites — list all monitored sites (admin)
 * POST /api/monitored-sites — add a site (admin)
 *   Body: { url: string, emails: string[] }
 */
import { normalizeUrl, getBaseDomain } from '../../_lib/crawl.js';
import { adminAuthCheck } from '../../_lib/monitor-auth.js';
import { getAllowedOrigin } from '../../_lib/cors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function onRequestOptions({ request, env }) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function onRequestGet({ request, env }) {
  const denied = adminAuthCheck(request, env, (d, s) => json(request, env, d, s));
  if (denied) return denied;

  const result = await env.DB.prepare(
    `SELECT ms.id, ms.url, ms.base_domain, ms.emails, ms.last_scan_id, ms.pending_scan_id,
            ms.next_scan_at, ms.created_at, ms.last_scan_status, ms.last_scan_error, ms.user_id,
            s.finished_at AS last_scan_at
     FROM monitored_sites ms
     LEFT JOIN scans s ON s.id = ms.last_scan_id
     ORDER BY ms.created_at DESC`
  ).all();

  return json(request, env, { sites: result.results || [] });
}

export async function onRequestPost({ request, env }) {
  const denied = adminAuthCheck(request, env, (d, s) => json(request, env, d, s));
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json(request, env, { error: 'Invalid JSON' }, 400);
  }

  const { url: rawUrl, emails } = body;
  if (!rawUrl) return json(request, env, { error: 'url is required' }, 400);
  if (!Array.isArray(emails) || emails.length === 0) return json(request, env, { error: 'emails must be a non-empty array' }, 400);

  const invalidEmail = emails.find(e => typeof e !== 'string' || !EMAIL_RE.test(e.trim()));
  if (invalidEmail !== undefined) return json(request, env, { error: 'Invalid email address: ' + invalidEmail }, 400);

  let startUrl;
  try {
    startUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    new URL(startUrl);
  } catch {
    return json(request, env, { error: 'Invalid URL' }, 400);
  }

  const normalizedStart = normalizeUrl(startUrl, startUrl);
  if (!normalizedStart) return json(request, env, { error: 'Could not normalize URL' }, 400);

  const baseDomain = getBaseDomain(normalizedStart);
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = Math.floor(Date.now() / 1000);
  // Random spread within next 24 hours for first scan — prevents all new sites scanning simultaneously
  const nextScanAt = now + Math.floor(Math.random() * 86400);

  await env.DB.prepare(
    `INSERT INTO monitored_sites (id, url, base_domain, emails, next_scan_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, startUrl, baseDomain, JSON.stringify(emails), nextScanAt, now).run();

  return json(request, env, { id }, 201);
}
