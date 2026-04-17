/**
 * POST /api/scans
 * Creates a new scan, fetches homepage, populates crawl queue.
 */
import { normalizeUrl, getBaseDomain } from '../../_lib/crawl.js';
import { bootstrapScan } from '../../_lib/scan-bootstrap.js';
import { corsJson, corsOptions } from '../../_lib/response.js';
import { generateId } from '../../_lib/constants.js';

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

export function onRequestOptions({ request, env }) {
  return corsOptions(request, env, 'POST, OPTIONS');
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsJson(request, env, { error: 'Invalid JSON' }, 400);
  }

  const { url: rawUrl, turnstileToken } = body;
  if (!rawUrl) {
    return corsJson(request, env, { error: 'url is required' }, 400);
  }

  const humanVerified = await verifyTurnstile(turnstileToken, env);
  if (!humanVerified) {
    return corsJson(request, env, { error: 'Security check failed. Please try again.' }, 403);
  }

  let startUrl;
  try {
    startUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    new URL(startUrl);
  } catch {
    return corsJson(request, env, { error: 'Invalid URL' }, 400);
  }

  const normalizedStart = normalizeUrl(startUrl, startUrl);
  if (!normalizedStart) {
    return corsJson(request, env, { error: 'Could not normalize URL' }, 400);
  }

  const baseDomain = getBaseDomain(normalizedStart);

  // Global concurrent scan cap — only count scans started in the last 30 minutes
  // (older ones are abandoned browser tabs, not active CPU consumers)
  const active = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM scans
     WHERE status IN ('pending', 'running')
       AND started_at > unixepoch() - 1800`
  ).first();
  if (active.n >= 10) {
    return corsJson(request, env, { error: 'Server busy. Please try again shortly.' }, 503);
  }

  // Per-domain cooldown — prevents repeated scans of the same site
  const recent = await env.DB.prepare(
    `SELECT id FROM scans WHERE base_domain = ? AND started_at > ? AND status != 'failed' LIMIT 1`
  ).bind(baseDomain, Math.floor(Date.now() / 1000) - 600).first();
  if (recent) {
    return corsJson(request, env, { error: 'A scan for this domain was recently started. Please wait 10 minutes.' }, 429);
  }

  const scanId = generateId();

  let homepageOk = true;
  try {
    const result = await bootstrapScan(env, scanId, rawUrl, baseDomain);
    homepageOk = result.homepageOk;
  } catch {
    homepageOk = false;
  }

  return corsJson(request, env, { scanId, ok: homepageOk }, 201);
}
