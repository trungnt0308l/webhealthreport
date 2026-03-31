/**
 * HTTP checking utilities.
 * Optimized for Cloudflare Workers CPU budget:
 * - Single fetch per URL (no manual redirect loop)
 * - No HEAD→GET fallback (saves a round-trip per URL)
 * - Short timeout
 */

const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = 'WebHealthReport/1.0 Bot';

async function doFetch(url, method) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    clearTimeout(timer);
    return {
      status: response.status,
      finalUrl: response.url || url,
      redirectCount: 0,
      responseMs: Date.now() - start,
      error: null,
    };
  } catch {
    clearTimeout(timer);
    return {
      status: null,
      finalUrl: url,
      redirectCount: 0,
      responseMs: Date.now() - start,
      error: 'error',
    };
  }
}

/**
 * Check a URL via HEAD, with GET fallback for 4xx responses.
 * Some servers (SPAs, embedded content) return 404 to HEAD but 200 to GET.
 */
export async function checkUrl(url) {
  const result = await doFetch(url, 'HEAD');
  if (result.status !== null && result.status >= 400) {
    return doFetch(url, 'GET');
  }
  return result;
}

/**
 * Fetch a page for HTML parsing.
 */
export async function fetchPage(url) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timer);
    return { response, responseMs: Date.now() - start, finalUrl: response.url || url };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Run all checks in parallel (no chunking — all I/O bound).
 */
export async function checkBatch(items) {
  return Promise.all(
    items.map(item =>
      checkUrl(item.url)
        .then(r => ({ ...item, ...r }))
        .catch(() => ({ ...item, status: null, error: 'error', responseMs: 0, finalUrl: item.url, redirectCount: 0 }))
    )
  );
}
