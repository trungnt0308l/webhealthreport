/**
 * POST /api/debug/check-url — run the exact same URL check the scan engine uses.
 * Returns HEAD, GET, and checkUrl results separately so you can see why a URL
 * was marked broken.
 * Requires monitor key auth (same as /api/monitored-sites).
 */
import { doFetch, checkUrl } from '../../_lib/checker.js';
import { adminAuthCheck } from '../../_lib/monitor-auth.js';
import { getAllowedOrigin } from '../../_lib/cors.js';

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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function onRequestPost({ request, env }) {
  const denied = adminAuthCheck(request, env, (d, s) => json(request, env, d, s));
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json(request, env, { error: 'Invalid JSON body' }, 400);
  }

  const { url } = body || {};
  if (!url || typeof url !== 'string') {
    return json(request, env, { error: 'url is required' }, 400);
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return json(request, env, { error: 'Invalid URL' }, 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return json(request, env, { error: 'Only http/https URLs are supported' }, 400);
  }

  // Run HEAD and GET independently, then checkUrl (which does HEAD→GET fallback internally)
  const [headResult, getResult, checkUrlResult] = await Promise.all([
    doFetch(url, 'HEAD'),
    doFetch(url, 'GET'),
    checkUrl(url),
  ]);

  return json(request, env, {
    url,
    head: headResult,
    get: getResult,
    checkUrl: checkUrlResult,
  });
}
