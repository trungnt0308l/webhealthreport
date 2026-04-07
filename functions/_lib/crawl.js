/**
 * URL normalization and HTML parsing utilities.
 * Runs in Cloudflare Workers runtime.
 *
 * CPU optimization notes:
 * - parseHtml uses targeted selectors instead of body-wide text handler
 * - No response.clone() — body is consumed once
 * - Links capped at 250 to limit normalization loop
 */

/**
 * Decode HTML entities in a string.
 * Handles decimal (&#NNN;), hex (&#xHHH;), and common named entities.
 * Used to normalize href/src attributes and title text before URL parsing or storage,
 * because Cloudflare HTMLRewriter returns raw HTML-encoded values from getAttribute().
 */
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: '\u00a0', ndash: '\u2013', mdash: '\u2014',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026',
};

function decodeHtmlEntities(str) {
  if (!str || !str.includes('&')) return str;
  return str.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g, (match, dec, hex, name) => {
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (name) return NAMED_ENTITIES[name] ?? match;
    return match;
  });
}

/**
 * If a URL's path contains an unencoded '://' (e.g. a proxy CDN that embeds a full
 * URL in the path like /fetch/.../https://media.cdn.example.com/...), the WHATWG URL
 * parser collapses the inner '//' to '/', producing a wrong URL. Pre-encode those
 * occurrences so the path is preserved correctly.
 */
function encodeEmbeddedProtocols(urlStr) {
  const schemeEndIdx = urlStr.indexOf('://');
  if (schemeEndIdx < 0) return urlStr;
  const pathStart = urlStr.indexOf('/', schemeEndIdx + 3);
  if (pathStart < 0) return urlStr;
  const path = urlStr.slice(pathStart);
  if (!path.includes('://')) return urlStr;
  return urlStr.slice(0, pathStart) + path.replaceAll('://', '%3A%2F%2F');
}

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'msclkid', 'ref', 'source',
]);

const MAX_LINKS_PER_PAGE = 250;

export function normalizeUrl(urlStr, baseUrl) {
  try {
    const url = new URL(encodeEmbeddedProtocols(urlStr), baseUrl);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') ||
        (url.protocol === 'http:' && url.port === '80')) {
      url.port = '';
    }
    if (url.pathname === '') url.pathname = '/';
    for (const key of TRACKING_PARAMS) {
      url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Normalize an external link URL for deduplication.
 * Strips query parameters — we only need to verify hostname+path is reachable,
 * not each unique query string variant (e.g. google.com/maps/dir/?destination=X).
 */
export function normalizeExternalUrl(urlStr, baseUrl) {
  try {
    const url = new URL(encodeEmbeddedProtocols(urlStr), baseUrl);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') ||
        (url.protocol === 'http:' && url.port === '80')) {
      url.port = '';
    }
    if (url.pathname === '') url.pathname = '/';
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Normalize an image URL for deduplication and queuing.
 * Strips only common tracking parameters (same as normalizeUrl) so that
 * CDN resize/format params (e.g. w=800, format=webp) are preserved.
 */
export function normalizeImageUrl(urlStr, baseUrl) {
  try {
    const url = new URL(encodeEmbeddedProtocols(urlStr), baseUrl);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') ||
        (url.protocol === 'http:' && url.port === '80')) {
      url.port = '';
    }
    if (url.pathname === '') url.pathname = '/';
    for (const key of TRACKING_PARAMS) {
      url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Domains that serve only tracking pixels, analytics scripts, ad beacons, and
 * similar resources with no link/page health value. URLs on these domains are
 * skipped entirely — never queued for crawling or link checking.
 */
const TRACKING_DOMAINS = new Set([
  // Google
  'www.google-analytics.com', 'analytics.google.com', 'ssl.google-analytics.com',
  'www.googletagmanager.com', 'googletagmanager.com',
  'www.googleadservices.com', 'googleadservices.com',
  'pagead2.googlesyndication.com', 'adservice.google.com',
  'stats.g.doubleclick.net', 'doubleclick.net', 'cm.g.doubleclick.net',
  // Meta / Facebook
  'connect.facebook.net', 'www.facebook.com',
  // Microsoft
  'bat.bing.com', 'clarity.ms', 'www.clarity.ms',
  // Adobe
  'sc.omtrdc.net', 'assets.adobedtm.com',
  // Hotjar
  'static.hotjar.com', 'vars.hotjar.com', 'script.hotjar.com',
  // Segment
  'cdn.segment.com', 'api.segment.io',
  // Amplitude
  'cdn.amplitude.com', 'api.amplitude.com',
  // Mixpanel
  'cdn.mxpnl.com', 'cdn.mixpanel.com',
  // Heap
  'cdn.heapanalytics.com', 'heapanalytics.com',
  // Intercom
  'js.intercomcdn.com', 'widget.intercom.io', 'api-iam.intercom.io',
  // LinkedIn
  'px.ads.linkedin.com', 'snap.licdn.com',
  // Twitter / X
  'static.ads-twitter.com', 'analytics.twitter.com',
  // HubSpot
  'js.hs-scripts.com', 'js.hsforms.net', 'js.hscta.net', 'js.hs-analytics.net',
  // Sentry / error tracking
  'browser.sentry-cdn.com', 'js.sentry-cdn.com',
  // Cloudflare Beacon
  'static.cloudflareinsights.com',
  // Cookiebot / consent banners
  'consent.cookiebot.com', 'consentcdn.cookiebot.com',
]);

/**
 * Path/filename patterns that indicate a tracking pixel or beacon.
 * Matched against the URL pathname.
 */
const TRACKING_PATH_RE = /\/(blank|pixel|spacer|1x1|tracking|beacon|collect|tr|px)(\.gif|\.png|\.jpg|\.svg)?(\?|$)/i;

/**
 * Returns true if the URL is a known tracking/analytics resource that should be
 * skipped during crawling and link checking.
 */
export function isTrackingUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (TRACKING_DOMAINS.has(u.hostname)) return true;
    if (TRACKING_PATH_RE.test(u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

export function getBaseDomain(urlStr) {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function stripWww(h) {
  return h.startsWith('www.') ? h.slice(4) : h;
}

export function isInternalUrl(urlStr, baseDomain) {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    const normHost = stripWww(host);
    const normBase = stripWww(baseDomain.toLowerCase());
    return normHost === normBase || normHost.endsWith('.' + normBase);
  } catch {
    return false;
  }
}

export function isHtmlContentType(ct) {
  return ct && ct.includes('text/html');
}

/**
 * Parse HTML response — extract links (with anchor text), title, and rough text length.
 * Does NOT clone the response (body consumed once).
 * Text length sampled from content elements only, stops at 300 chars.
 * Returns links as [{href, text}] — text is the visible anchor text.
 */
const MAX_IMAGES_PER_PAGE = 250;

/**
 * Parse srcset attribute value into an array of URLs.
 * srcset entries are separated by ", " (comma + whitespace).
 * Cloudinary-style URLs contain commas within path segments (e.g. c_crop,g_south)
 * but those commas are NEVER followed by whitespace — safe to split on /,\s+/.
 */
function parseSrcset(srcset) {
  if (!srcset) return [];
  return srcset
    .split(/,\s+/)
    .map(entry => decodeHtmlEntities(entry.trim().split(/\s+/)[0]))  // take URL before width/density descriptor
    .filter(u => u && !u.startsWith('data:'));
}

export async function parseHtml(response, maxLinks = MAX_LINKS_PER_PAGE, maxImages = MAX_IMAGES_PER_PAGE) {
  const links = []; // [{href, text}]
  const imageSrcs = new Set(); // deduplicate image URLs within a page
  const images = []; // [{src, alt}]
  let title = '';
  let visibleTextLength = 0;
  let curIdx = -1; // index into links[] for the currently-open <a>
  let curAlt = '';

  function addImage(src, alt) {
    if (images.length >= maxImages) return;
    if (!src || src.startsWith('data:') || imageSrcs.has(src)) return;
    imageSrcs.add(src);
    images.push({ src, alt: (alt || '').trim().slice(0, 100) });
  }

  await new HTMLRewriter()
    .on('title', {
      text(chunk) {
        if (title.length < 200) title += chunk.text;
      },
    })
    .on('a[href]', {
      element(el) {
        if (links.length >= maxLinks) { curIdx = -1; return; }
        const href = decodeHtmlEntities(el.getAttribute('href'));
        if (href && !href.startsWith('mailto:') && !href.startsWith('tel:') &&
            !href.startsWith('javascript:') && !href.startsWith('#')) {
          links.push({ href, text: '' });
          curIdx = links.length - 1;
        } else {
          curIdx = -1;
        }
      },
      text(chunk) {
        if (curIdx >= 0) links[curIdx].text += chunk.text;
      },
    })
    .on('img', {
      element(el) {
        const alt = el.getAttribute('alt') || '';
        // Prefer data-src (lazy loading) over src; also extract all srcset URLs
        const src = decodeHtmlEntities(el.getAttribute('data-src') || el.getAttribute('src'));
        if (src) addImage(src, alt);
        for (const u of parseSrcset(el.getAttribute('srcset') || el.getAttribute('data-srcset') || '')) {
          addImage(u, alt);
        }
      },
    })
    .on('source[srcset]', {
      // <picture><source srcset="..."> — responsive image sources
      element(el) {
        for (const u of parseSrcset(el.getAttribute('srcset') || '')) {
          addImage(u, '');
        }
      },
    })
    .on('p, li, h1, h2, h3, h4, h5, h6', {
      text(chunk) {
        if (visibleTextLength < 300) visibleTextLength += chunk.text.length;
      },
    })
    .transform(response)
    .arrayBuffer();

  for (const l of links) l.text = decodeHtmlEntities(l.text.trim()).slice(0, 100);

  return {
    title: decodeHtmlEntities(title.trim()),
    links,
    images,
    visibleTextLength,
  };
}
