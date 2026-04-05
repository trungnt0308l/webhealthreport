/**
 * POST /api/scans
 * Creates a new scan, fetches homepage, populates crawl queue.
 */
import { normalizeUrl, getBaseDomain } from '../../_lib/crawl.js';
import { bootstrapScan } from '../../_lib/scan-bootstrap.js';
import { getAllowedOrigin } from '../../_lib/cors.js';

async function verifyTurnstile(token, env) {
  // If no secret configured (local dev without test key), skip verification
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
  });
  const data = await res.json();
  return data.success === true;
}

function nanoid() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function corsResponse(request, env, body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Access-Control-Allow-Origin', getAllowedOrigin(request, env));
  headers.set('Content-Type', 'application/json');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(body, { ...init, headers });
}

export function onRequestOptions({ request, env }) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse(request, env, JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { url: rawUrl, turnstileToken } = body;
  if (!rawUrl) {
    return corsResponse(request, env, JSON.stringify({ error: 'url is required' }), { status: 400 });
  }

  const humanVerified = await verifyTurnstile(turnstileToken, env);
  if (!humanVerified) {
    return corsResponse(request, env, JSON.stringify({ error: 'Security check failed. Please try again.' }), { status: 403 });
  }

  let startUrl;
  try {
    startUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    new URL(startUrl);
  } catch {
    return corsResponse(request, env, JSON.stringify({ error: 'Invalid URL' }), { status: 400 });
  }

  const normalizedStart = normalizeUrl(startUrl, startUrl);
  if (!normalizedStart) {
    return corsResponse(request, env, JSON.stringify({ error: 'Could not normalize URL' }), { status: 400 });
  }

  const baseDomain = getBaseDomain(normalizedStart);

  // Global concurrent scan cap — prevents saturation via many different domains
  const active = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM scans WHERE status IN ('pending', 'running')`
  ).first();
  if (active.n >= 5) {
    return corsResponse(request, env, JSON.stringify({ error: 'Server busy. Please try again shortly.' }), { status: 503 });
  }

  // Per-domain cooldown — prevents repeated scans of the same site
  const recent = await env.DB.prepare(
    `SELECT id FROM scans WHERE base_domain = ? AND started_at > ? AND status != 'failed' LIMIT 1`
  ).bind(baseDomain, Math.floor(Date.now() / 1000) - 600).first();
  if (recent) {
    return corsResponse(request, env, JSON.stringify({ error: 'A scan for this domain was recently started. Please wait 10 minutes.' }), { status: 429 });
  }

  const scanId = nanoid();

  let homepageOk = true;
  try {
    const result = await bootstrapScan(env, scanId, rawUrl, baseDomain);
    homepageOk = result.homepageOk;
  } catch {
    homepageOk = false;
  }

  return corsResponse(request, env, JSON.stringify({ scanId, ok: homepageOk }), { status: 201 });
}
