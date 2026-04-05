/**
 * bootstrapScan — creates the scan record, fetches the homepage, and seeds the crawl queue.
 * Extracted so it can be called by both the HTTP handler (scans/index.js) and the scheduler.
 * Throws on fatal errors so callers can release any held mutexes.
 */
import { normalizeUrl, normalizeImageUrl, getBaseDomain, parseHtml, isInternalUrl, isHtmlContentType } from './crawl.js';
import { fetchPage } from './checker.js';

/**
 * @param {object} env         - Cloudflare env (must have DB binding)
 * @param {string} scanId      - Pre-generated scan ID
 * @param {string} rawUrl      - Raw URL from user/stored site (with or without protocol)
 * @param {string} [baseDomain] - Pre-computed base domain; derived from URL if omitted
 * @param {string} [siteId]    - Monitored site ID, if this scan belongs to one
 * @returns {{ homepageOk: boolean }}
 * @throws on network failure or DB error
 */
export async function bootstrapScan(env, scanId, rawUrl, baseDomain, siteId = null) {
  const startUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
  const normalizedStart = normalizeUrl(startUrl, startUrl);
  if (!normalizedStart) throw new Error('Could not normalize URL: ' + rawUrl);

  const resolvedBaseDomain = baseDomain || getBaseDomain(normalizedStart);
  const now = Math.floor(Date.now() / 1000);

  // Upsert: INSERT for the HTTP path (no pre-existing record), UPDATE for the scheduler
  // path (stub was pre-inserted to satisfy the FK on monitored_sites.pending_scan_id).
  await env.DB.prepare(
    `INSERT INTO scans (id, url, normalized_start_url, base_domain, site_id, status, started_at, current_step)
     VALUES (?, ?, ?, ?, ?, 'running', ?, 'Checking homepage')
     ON CONFLICT(id) DO UPDATE SET
       url = excluded.url,
       normalized_start_url = excluded.normalized_start_url,
       base_domain = excluded.base_domain,
       site_id = excluded.site_id,
       status = 'running',
       started_at = excluded.started_at,
       current_step = 'Checking homepage'`
  ).bind(scanId, startUrl, normalizedStart, resolvedBaseDomain, siteId, now).run();

  let homepageOk = true;
  try {
    const { response, responseMs, finalUrl, redirectCount } = await fetchPage(normalizedStart);
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

    await env.DB.prepare(
      `INSERT INTO pages (scan_id, url, normalized_url, status_code, content_type, title, text_length, response_ms, redirect_count, final_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(scanId, startUrl, normalizedStart, statusCode, contentType, title, visibleTextLength, responseMs, redirectCount || 0, finalUrl || normalizedStart).run();

    if (statusCode >= 400) homepageOk = false;

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
      const isInternal = isInternalUrl(norm, resolvedBaseDomain);
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

    // Homepage inserted as 'done' to claim its unique-index slot — prevents re-crawl
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

    await env.DB.prepare(
      `UPDATE scans SET current_step = 'Discovering pages', pages_crawled = 1 WHERE id = ?`
    ).bind(scanId).run();

  } catch (err) {
    homepageOk = false;
    await env.DB.prepare(
      `UPDATE scans SET status = 'failed', error_message = ?, finished_at = ? WHERE id = ?`
    ).bind(String(err), now, scanId).run();
    throw err;
  }

  return { homepageOk };
}
