/**
 * POST /api/scans
 * Creates a new scan, fetches homepage, populates crawl queue.
 */
import { normalizeUrl, getBaseDomain } from '../../_lib/crawl.js';
import { bootstrapScan } from '../../_lib/scan-bootstrap.js';

function nanoid() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', '*');
  return r;
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
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
    return cors(new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  }

  const { url: rawUrl } = body;
  if (!rawUrl) {
    return cors(new Response(JSON.stringify({ error: 'url is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  }

  let startUrl;
  try {
    startUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    new URL(startUrl);
  } catch {
    return cors(new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  }

  const normalizedStart = normalizeUrl(startUrl, startUrl);
  if (!normalizedStart) {
    return cors(new Response(JSON.stringify({ error: 'Could not normalize URL' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  }

  const baseDomain = getBaseDomain(normalizedStart);
  const scanId = nanoid();

  let homepageOk = true;
  try {
    const result = await bootstrapScan(env, scanId, rawUrl, baseDomain);
    homepageOk = result.homepageOk;
  } catch {
    homepageOk = false;
  }

  return cors(new Response(JSON.stringify({ scanId, ok: homepageOk }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  }));
}
