/**
 * POST /api/scans
 * Creates a new scan, fetches homepage, populates crawl queue.
 */
import { normalizeUrl, normalizeImageUrl, getBaseDomain, parseHtml, isInternalUrl, isHtmlContentType } from '../../_lib/crawl.js';
import { fetchPage } from '../../_lib/checker.js';

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

  // Validate URL
  let startUrl;
  try {
    startUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    new URL(startUrl); // throws if invalid
  } catch {
    return cors(new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  }

  const normalizedStart = normalizeUrl(startUrl, startUrl);
  if (!normalizedStart) {
    return cors(new Response(JSON.stringify({ error: 'Could not normalize URL' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  }

  const baseDomain = getBaseDomain(normalizedStart);
  const scanId = nanoid();
  const now = Math.floor(Date.now() / 1000);

  // Create scan record
  await env.DB.prepare(
    `INSERT INTO scans (id, url, normalized_start_url, base_domain, status, started_at, current_step)
     VALUES (?, ?, ?, ?, 'running', ?, 'Checking homepage')`
  ).bind(scanId, startUrl, normalizedStart, baseDomain, now).run();

  // Fetch homepage
  let homepageOk = true;
  try {
    const { response, responseMs, finalUrl } = await fetchPage(normalizedStart);
    const contentType = response.headers.get('content-type') || '';
    const statusCode = response.status;
    let title = '';
    let visibleTextLength = 0;
    let links = [];
    let images = [];

    if (isHtmlContentType(contentType) && statusCode < 400) {
      const parsed = await parseHtml(response);
      title = parsed.title;
      visibleTextLength = parsed.visibleTextLength;
      links = parsed.links;
      images = parsed.images;
    }

    // Save homepage as first page
    await env.DB.prepare(
      `INSERT INTO pages (scan_id, url, normalized_url, status_code, content_type, title, text_length, response_ms, final_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(scanId, startUrl, normalizedStart, statusCode, contentType, title, visibleTextLength, responseMs, finalUrl || normalizedStart).run();

    if (statusCode >= 400) {
      homepageOk = false;
    }

    // Seed crawl queue with discovered links and images
    const seen = new Set([normalizedStart]);
    const toInsert = [];

    for (const { href, text } of links) {
      const norm = normalizeUrl(href, finalUrl);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      try {
        const u = new URL(norm);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      } catch { continue; }
      const isInternal = isInternalUrl(norm, baseDomain);
      toInsert.push({ norm, urlType: isInternal ? 'internal' : 'external', anchorText: text || '' });
    }

    for (const { src, alt } of images) {
      const norm = normalizeImageUrl(src, finalUrl);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      try {
        const u = new URL(norm);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      } catch { continue; }
      toInsert.push({ norm, urlType: 'image', anchorText: alt || '' });
    }

    // Batch insert queue items.
    // The homepage is inserted as 'done' to claim its slot in the unique index —
    // any later page that links back to the start URL will hit INSERT OR IGNORE
    // and be silently skipped, preventing the homepage from being re-crawled.
    const pendingStmt = env.DB.prepare(
      `INSERT OR IGNORE INTO crawl_queue (scan_id, url, normalized_url, url_type, source_url, depth, anchor_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const inserts = [
      env.DB.prepare(
        `INSERT OR IGNORE INTO crawl_queue (scan_id, url, normalized_url, url_type, source_url, depth, anchor_text, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'done')`
      ).bind(scanId, normalizedStart, normalizedStart, 'internal', null, 0, ''),
      ...toInsert.map(({ norm, urlType, anchorText }) =>
        pendingStmt.bind(scanId, norm, norm, urlType, startUrl, 1, anchorText)
      ),
    ];
    await env.DB.batch(inserts);

    // Update scan step
    await env.DB.prepare(
      `UPDATE scans SET current_step = 'Discovering pages', pages_crawled = 1 WHERE id = ?`
    ).bind(scanId).run();

  } catch (err) {
    homepageOk = false;
    await env.DB.prepare(
      `UPDATE scans SET status = 'failed', error_message = ?, finished_at = ? WHERE id = ?`
    ).bind(String(err), now, scanId).run();
  }

  return cors(new Response(JSON.stringify({ scanId, ok: homepageOk }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  }));
}
