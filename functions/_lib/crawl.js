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
  // XML/HTML basics
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  // Spacing & punctuation
  nbsp: '\u00a0', iexcl: '\u00a1', cent: '\u00a2', pound: '\u00a3',
  curren: '\u00a4', yen: '\u00a5', brvbar: '\u00a6', sect: '\u00a7',
  uml: '\u00a8', copy: '\u00a9', ordf: '\u00aa', laquo: '\u00ab',
  not: '\u00ac', shy: '\u00ad', reg: '\u00ae', macr: '\u00af',
  deg: '\u00b0', plusmn: '\u00b1', sup2: '\u00b2', sup3: '\u00b3',
  acute: '\u00b4', micro: '\u00b5', para: '\u00b6', middot: '\u00b7',
  cedil: '\u00b8', sup1: '\u00b9', ordm: '\u00ba', raquo: '\u00bb',
  frac14: '\u00bc', frac12: '\u00bd', frac34: '\u00be', iquest: '\u00bf',
  // Latin uppercase with diacritics
  Agrave: '\u00c0', Aacute: '\u00c1', Acirc: '\u00c2', Atilde: '\u00c3',
  Auml: '\u00c4', Aring: '\u00c5', AElig: '\u00c6', Ccedil: '\u00c7',
  Egrave: '\u00c8', Eacute: '\u00c9', Ecirc: '\u00ca', Euml: '\u00cb',
  Igrave: '\u00cc', Iacute: '\u00cd', Icirc: '\u00ce', Iuml: '\u00cf',
  ETH: '\u00d0', Ntilde: '\u00d1', Ograve: '\u00d2', Oacute: '\u00d3',
  Ocirc: '\u00d4', Otilde: '\u00d5', Ouml: '\u00d6', times: '\u00d7',
  Oslash: '\u00d8', Ugrave: '\u00d9', Uacute: '\u00da', Ucirc: '\u00db',
  Uuml: '\u00dc', Yacute: '\u00dd', THORN: '\u00de', szlig: '\u00df',
  // Latin lowercase with diacritics
  agrave: '\u00e0', aacute: '\u00e1', acirc: '\u00e2', atilde: '\u00e3',
  auml: '\u00e4', aring: '\u00e5', aelig: '\u00e6', ccedil: '\u00e7',
  egrave: '\u00e8', eacute: '\u00e9', ecirc: '\u00ea', euml: '\u00eb',
  igrave: '\u00ec', iacute: '\u00ed', icirc: '\u00ee', iuml: '\u00ef',
  eth: '\u00f0', ntilde: '\u00f1', ograve: '\u00f2', oacute: '\u00f3',
  ocirc: '\u00f4', otilde: '\u00f5', ouml: '\u00f6', divide: '\u00f7',
  oslash: '\u00f8', ugrave: '\u00f9', uacute: '\u00fa', ucirc: '\u00fb',
  uuml: '\u00fc', yacute: '\u00fd', thorn: '\u00fe', yuml: '\u00ff',
  // Latin Extended-A (common)
  OElig: '\u0152', oelig: '\u0153', Scaron: '\u0160', scaron: '\u0161',
  Yuml: '\u0178', fnof: '\u0192',
  // General punctuation & typographic
  ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019',
  sbquo: '\u201a', ldquo: '\u201c', rdquo: '\u201d', bdquo: '\u201e',
  dagger: '\u2020', Dagger: '\u2021', permil: '\u2030', lsaquo: '\u2039',
  rsaquo: '\u203a', bull: '\u2022', hellip: '\u2026', prime: '\u2032',
  Prime: '\u2033', oline: '\u203e', frasl: '\u2044',
  // Currency & math
  euro: '\u20ac', trade: '\u2122', image: '\u2111', weierp: '\u2118',
  real: '\u211c', alefsym: '\u2135', larr: '\u2190', uarr: '\u2191',
  rarr: '\u2192', darr: '\u2193', harr: '\u2194', crarr: '\u21b5',
  forall: '\u2200', part: '\u2202', exist: '\u2203', empty: '\u2205',
  nabla: '\u2207', isin: '\u2208', notin: '\u2209', ni: '\u220b',
  prod: '\u220f', sum: '\u2211', minus: '\u2212', lowast: '\u2217',
  radic: '\u221a', prop: '\u221d', infin: '\u221e', ang: '\u2220',
  and: '\u2227', or: '\u2228', cap: '\u2229', cup: '\u222a',
  int: '\u222b', there4: '\u2234', sim: '\u223c', cong: '\u2245',
  asymp: '\u2248', ne: '\u2260', equiv: '\u2261', le: '\u2264',
  ge: '\u2265', sub: '\u2282', sup: '\u2283', nsub: '\u2284',
  sube: '\u2286', supe: '\u2287', oplus: '\u2295', otimes: '\u2297',
  perp: '\u22a5', sdot: '\u22c5',
  // Geometric / misc
  lceil: '\u2308', rceil: '\u2309', lfloor: '\u230a', rfloor: '\u230b',
  lang: '\u2329', rang: '\u232a', loz: '\u25ca',
  spades: '\u2660', clubs: '\u2663', hearts: '\u2665', diams: '\u2666',
  // Greek uppercase
  Alpha: '\u0391', Beta: '\u0392', Gamma: '\u0393', Delta: '\u0394',
  Epsilon: '\u0395', Zeta: '\u0396', Eta: '\u0397', Theta: '\u0398',
  Iota: '\u0399', Kappa: '\u039a', Lambda: '\u039b', Mu: '\u039c',
  Nu: '\u039d', Xi: '\u039e', Omicron: '\u039f', Pi: '\u03a0',
  Rho: '\u03a1', Sigma: '\u03a3', Tau: '\u03a4', Upsilon: '\u03a5',
  Phi: '\u03a6', Chi: '\u03a7', Psi: '\u03a8', Omega: '\u03a9',
  // Greek lowercase
  alpha: '\u03b1', beta: '\u03b2', gamma: '\u03b3', delta: '\u03b4',
  epsilon: '\u03b5', zeta: '\u03b6', eta: '\u03b7', theta: '\u03b8',
  iota: '\u03b9', kappa: '\u03ba', lambda: '\u03bb', mu: '\u03bc',
  nu: '\u03bd', xi: '\u03be', omicron: '\u03bf', pi: '\u03c0',
  rho: '\u03c1', sigmaf: '\u03c2', sigma: '\u03c3', tau: '\u03c4',
  upsilon: '\u03c5', phi: '\u03c6', chi: '\u03c7', psi: '\u03c8',
  omega: '\u03c9', thetasym: '\u03d1', upsih: '\u03d2', piv: '\u03d6',
  // Whitespace / zero-width
  ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', zwnj: '\u200c',
  zwj: '\u200d', lrm: '\u200e', rlm: '\u200f',
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
