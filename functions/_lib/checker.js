/**
 * HTTP checking utilities.
 * Optimized for Cloudflare Workers CPU budget:
 * - Manual redirect following to track hop count (needed for redirect chain detection)
 * - HEAD→GET fallback for 4xx (some servers reject HEAD)
 * - Short timeout per hop
 */

import { crawlFetch } from './network.js';

// Full browser header set — sending only User-Agent triggers bot detection on
// many WAFs (Cloudflare, Akamai, DataDome). These headers match Chrome 146 on Windows.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="146", "Google Chrome";v="146", "Not-A.Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

/**
 * Fetch a URL with manual redirect following so we can count hops.
 * Returns { status, finalUrl, redirectCount, responseMs, error }.
 */
export async function doFetch(url, method, { referer } = {}) {
  const headers = referer
    ? { ...BROWSER_HEADERS, 'Referer': referer, 'sec-fetch-site': 'same-origin' }
    : BROWSER_HEADERS;
  const start = Date.now();
  try {
    const { response, finalUrl, redirectCount } = await crawlFetch(url, { method, headers, body: false });
    return { status: response.status, finalUrl, redirectCount, responseMs: Date.now() - start, error: null };
  } catch {
    return { status: null, finalUrl: url, redirectCount: 0, responseMs: Date.now() - start, error: 'error' };
  }
}

/**
 * Check a URL via HEAD, with GET fallback for 4xx responses.
 * Some servers (SPAs, embedded content) return 404 to HEAD but 200 to GET.
 * Returns redirectCount from the HEAD check (representative of the chain length).
 */
async function _checkUrl(url, { referer } = {}) {
  const result = await doFetch(url, 'HEAD', { referer });
  if (result.status !== null && result.status >= 400) {
    const getResult = await doFetch(url, 'GET', { referer });
    return { ...getResult, redirectCount: Math.max(result.redirectCount, getResult.redirectCount) };
  }
  return result;
}

export function checkUrl(url, { referer } = {}) {
  return _checkUrl(url, { referer });
}

/**
 * Fetch a page for HTML parsing.
 * Validates each redirect before fetching, and buffers only bounded HTML.
 * Returns { response, responseMs, finalUrl, redirectCount }.
 */
export async function fetchPage(url, { referer } = {}) {
  const headers = referer
    ? { ...BROWSER_HEADERS, 'Referer': referer, 'sec-fetch-site': 'same-origin' }
    : BROWSER_HEADERS;
  const start = Date.now();
  return { ...await crawlFetch(url, { headers }), responseMs: Date.now() - start };
}

/**
 * Run all checks in parallel (no chunking — all I/O bound).
 */
export async function checkBatch(items) {
  return Promise.all(
    items.map(item =>
      checkUrl(item.url, item.source_url ? { referer: item.source_url } : {})
        .then(r => ({ ...item, ...r }))
        .catch(() => ({ ...item, status: null, error: 'error', responseMs: 0, finalUrl: item.url, redirectCount: 0 }))
    )
  );
}
