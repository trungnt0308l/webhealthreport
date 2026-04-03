/**
 * URL normalization and HTML parsing utilities.
 * Runs in Cloudflare Workers runtime.
 *
 * CPU optimization notes:
 * - parseHtml uses targeted selectors instead of body-wide text handler
 * - No response.clone() — body is consumed once
 * - Links capped at 100 to limit normalization loop
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

export function getBaseDomain(urlStr) {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isInternalUrl(urlStr, baseDomain) {
  try {
    const url = new URL(urlStr);
    return url.hostname.toLowerCase() === baseDomain ||
           url.hostname.toLowerCase().endsWith('.' + baseDomain);
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

export async function parseHtml(response) {
  const links = []; // [{href, text}]
  const imageSrcs = new Set(); // deduplicate image URLs within a page
  const images = []; // [{src, alt}]
  let title = '';
  let visibleTextLength = 0;
  let curIdx = -1; // index into links[] for the currently-open <a>
  let curAlt = '';

  function addImage(src, alt) {
    if (images.length >= MAX_IMAGES_PER_PAGE) return;
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
        if (links.length >= MAX_LINKS_PER_PAGE) { curIdx = -1; return; }
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
