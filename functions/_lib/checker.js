/**
 * HTTP checking utilities.
 * Optimized for Cloudflare Workers CPU budget:
 * - Manual redirect following to track hop count (needed for redirect chain detection)
 * - HEAD→GET fallback for 4xx (some servers reject HEAD)
 * - Short timeout per hop
 */

const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 10;

// Full browser header set — sending only User-Agent triggers bot detection on
// many WAFs (Cloudflare, Akamai, DataDome). These headers match Chrome 146 on Windows.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
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
async function doFetch(url, method) {
  const start = Date.now();
  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount <= MAX_REDIRECTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(currentUrl, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: BROWSER_HEADERS,
      });
      clearTimeout(timer);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return { status: response.status, finalUrl: currentUrl, redirectCount, responseMs: Date.now() - start, error: null };
        }
        redirectCount++;
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }

      return { status: response.status, finalUrl: currentUrl, redirectCount, responseMs: Date.now() - start, error: null };
    } catch {
      clearTimeout(timer);
      return { status: null, finalUrl: url, redirectCount, responseMs: Date.now() - start, error: 'error' };
    }
  }

  return { status: null, finalUrl: currentUrl, redirectCount, responseMs: Date.now() - start, error: 'too_many_redirects' };
}

/**
 * Check a URL via HEAD, with GET fallback for 4xx responses.
 * Some servers (SPAs, embedded content) return 404 to HEAD but 200 to GET.
 * Returns redirectCount from the HEAD check (representative of the chain length).
 */
export async function checkUrl(url) {
  const result = await doFetch(url, 'HEAD');
  if (result.status !== null && result.status >= 400) {
    const getResult = await doFetch(url, 'GET');
    // Preserve the redirect count from whichever gave the longer chain
    return { ...getResult, redirectCount: Math.max(result.redirectCount, getResult.redirectCount) };
  }
  return result;
}

/**
 * Fetch a page for HTML parsing.
 * Uses redirect: 'follow' (needed to get response body), then probes for exact
 * redirect count via a secondary HEAD if the URL changed.
 * Returns { response, responseMs, finalUrl, redirectCount }.
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
      headers: BROWSER_HEADERS,
    });
    clearTimeout(timer);
    const finalUrl = response.url || url;

    // Count redirects only when the URL actually changed (no extra request for non-redirecting pages)
    let redirectCount = 0;
    if (finalUrl !== url) {
      const probe = await doFetch(url, 'HEAD');
      redirectCount = probe.redirectCount ?? 1;
    }

    return { response, responseMs: Date.now() - start, finalUrl, redirectCount };
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
