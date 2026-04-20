/**
 * POST /api/debug/check-url — run the exact same URL check the scan engine uses.
 * Returns HEAD, GET, and checkUrl results separately so you can see why a URL
 * was marked broken.
 * Requires monitor key auth (same as /api/monitored-sites).
 */
import { doFetch, checkUrl } from '../../_lib/checker.js';
import { adminAuthCheck } from '../../_lib/monitor-auth.js';
import { corsJson, corsOptions } from '../../_lib/response.js';

const json = corsJson;

export function onRequestOptions({ request, env }) {
  return corsOptions(request, env, 'POST, OPTIONS');
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

  const referer = parsed.origin + '/';
  // Run HEAD and GET independently, then checkUrl (which does HEAD→GET fallback internally).
  // Also run checkUrl without Referer to show what the scan sees for URLs not linked from a page.
  const [headResult, getResult, checkUrlResult, checkUrlNoReferer] = await Promise.all([
    doFetch(url, 'HEAD', { referer }),
    doFetch(url, 'GET', { referer }),
    checkUrl(url, { referer }),
    checkUrl(url),
  ]);

  // Capture raw response headers and body snippet for WAF diagnosis.
  // Uses a stripped-down header set (no sec-fetch-*) to test whether those headers are triggering the block.
  let diagnostic = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const diagResponse = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': referer,
      },
    });
    clearTimeout(timer);
    const responseHeaders = Object.fromEntries(diagResponse.headers.entries());
    const bodyText = await diagResponse.text().catch(() => '');
    diagnostic = {
      status: diagResponse.status,
      headers: responseHeaders,
      bodySnippet: bodyText.slice(0, 500),
    };
  } catch (e) {
    diagnostic = { error: String(e) };
  }

  return json(request, env, {
    url,
    head: headResult,
    get: getResult,
    checkUrl: checkUrlResult,
    checkUrlNoReferer,
    diagnostic,
  });
}
