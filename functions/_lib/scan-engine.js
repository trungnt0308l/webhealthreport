/**
 * processBatch — claims and processes one batch of crawl_queue items for a scan.
 * Extracted so it can be called by both the HTTP status endpoint and the scheduler Worker.
 *
 * Returns { status: 'running'|'complete'|'failed', recentChecks: [] }
 */
import { normalizeUrl, normalizeExternalUrl, normalizeImageUrl, parseHtml, isInternalUrl, isHtmlContentType, isTrackingUrl } from './crawl.js';
import { checkBatch, fetchPage } from './checker.js';
import { detectIssues } from './issues.js';

const HTML_BATCH_SIZE = 8;
const HEAD_BATCH_SIZE = 50;
const MAX_DEPTH = 5;
const D1_CHUNK = 100;

const FREE_LIMITS    = { maxPages: 500,  maxLinks: 5000,  maxLinksPerPage: 250, maxImagesPerPage: 250 };
const PREMIUM_LIMITS = { maxPages: 1000, maxLinks: 10000, maxLinksPerPage: 250, maxImagesPerPage: 250 };
const BOT_BLOCKED_STATUSES = new Set([403, 426, 429, 526, 530, 999]);

async function batchAll(env, stmts) {
  for (let i = 0; i < stmts.length; i += D1_CHUNK) {
    await env.DB.batch(stmts.slice(i, i + D1_CHUNK));
  }
}

async function finalize(env, scan, scanId, siteId = null) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`UPDATE scans SET current_step = 'Analyzing issues' WHERE id = ?`).bind(scanId).run();

  const BOT_CODES = '403,426,429,526,530,999';
  const [
    pagesResult,
    brokenInternalResult,
    brokenImagesResult,
    redirectChainsResult,
    brokenExternalResult,
    internalSourcesResult,
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT url, status_code, title, text_length, response_ms, content_type FROM pages WHERE scan_id = ?`
    ).bind(scanId).all(),
    env.DB.prepare(
      `SELECT 'internal' AS target_type, normalized_target_url, source_url, anchor_text, response_status, 0 AS redirect_count, NULL AS final_url
       FROM link_checks WHERE scan_id = ? AND target_type = 'internal' AND response_status >= 400`
    ).bind(scanId).all(),
    env.DB.prepare(
      `SELECT 'image' AS target_type, normalized_target_url, source_url, anchor_text, response_status, 0 AS redirect_count, NULL AS final_url
       FROM link_checks WHERE scan_id = ? AND target_type = 'image'
       AND (response_status IS NULL OR (response_status >= 400 AND response_status NOT IN (${BOT_CODES})))`
    ).bind(scanId).all(),
    env.DB.prepare(
      `SELECT 'internal' AS target_type, normalized_target_url, source_url, NULL AS anchor_text, response_status, redirect_count, final_url
       FROM link_checks WHERE scan_id = ? AND target_type = 'internal' AND redirect_count >= 2`
    ).bind(scanId).all(),
    env.DB.prepare(
      `SELECT 'external' AS target_type, normalized_target_url, source_url, anchor_text, response_status, 0 AS redirect_count, NULL AS final_url
       FROM link_checks WHERE scan_id = ? AND target_type = 'external'
       AND (response_status IS NULL OR (response_status >= 400 AND response_status NOT IN (${BOT_CODES})))`
    ).bind(scanId).all(),
    env.DB.prepare(
      `SELECT normalized_url AS normalized_target_url, source_url
       FROM crawl_queue WHERE scan_id = ? AND url_type = 'internal'`
    ).bind(scanId).all(),
  ]);

  const pageList = pagesResult.results || [];
  const linkCheckList = [
    ...(brokenInternalResult.results || []),
    ...(brokenImagesResult.results || []),
    ...(redirectChainsResult.results || []),
    ...(brokenExternalResult.results || []),
  ];
  const internalSourceMap = new Map(
    (internalSourcesResult.results || []).map(r => [r.normalized_target_url, r.source_url])
  );
  const issues = detectIssues(scanId, pageList, linkCheckList, internalSourceMap, scan.base_domain);

  if (issues.length > 0) {
    await batchAll(env, issues.map(i =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO issues (scan_id, issue_type, severity, fingerprint, title, explanation, recommended_action, affected_count, example_json, target_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(i.scan_id, i.issue_type, i.severity, i.fingerprint, i.title, i.explanation, i.recommended_action, i.affected_count, i.example_json, i.target_url ?? '')
    ));

    if (siteId) {
      await batchAll(env, issues.map(i =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO issue_history (site_id, issue_type, target_url, first_detected_at)
           VALUES (?, ?, ?, ?)`
        ).bind(siteId, i.issue_type, i.target_url ?? '', now)
      ));
    }
  }

  await env.DB.prepare(
    `UPDATE scans SET status = 'complete', finished_at = ?, issues_found = ?, current_step = 'Complete' WHERE id = ?`
  ).bind(now, issues.length, scanId).run();

  await env.DB.prepare('DELETE FROM crawl_queue WHERE scan_id = ?').bind(scanId).run();
}

export async function processBatch(env, scanId, siteId = null) {
  const scan = await env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(scanId).first();
  if (!scan) throw new Error(`Scan not found: ${scanId}`);

  if (scan.status === 'complete' || scan.status === 'failed') {
    return { status: scan.status, recentChecks: [] };
  }

  const LIMITS = scan.site_id ? PREMIUM_LIMITS : FREE_LIMITS;

  // Reset stale 'processing' items (> 10 min) — handles scheduler Worker restarts
  await env.DB.prepare(
    `UPDATE crawl_queue SET status = 'pending', claimed_at = NULL
     WHERE scan_id = ? AND status = 'processing' AND claimed_at IS NOT NULL AND claimed_at < unixepoch() - 120`
  ).bind(scanId).run();

  const linksCounted = scan.links_checked || 0;
  const pagesCounted = scan.pages_crawled || 0;

  if (pagesCounted >= LIMITS.maxPages || linksCounted >= LIMITS.maxLinks) {
    await finalize(env, scan, scanId, siteId);
    return { status: 'complete', recentChecks: [] };
  }

  const htmlLimit = pagesCounted < LIMITS.maxPages ? HTML_BATCH_SIZE : 0;
  const [htmlBatch, headBatch] = await Promise.all([
    htmlLimit > 0
      ? env.DB.prepare(
          `UPDATE crawl_queue SET status = 'processing', claimed_at = unixepoch()
           WHERE id IN (
             SELECT id FROM crawl_queue
             WHERE scan_id = ? AND status = 'pending' AND url_type = 'internal'
             ORDER BY depth, id
             LIMIT ?
           )
           RETURNING id, url, normalized_url, url_type, source_url, depth, anchor_text`
        ).bind(scanId, htmlLimit).all()
      : { results: [] },
    env.DB.prepare(
      `UPDATE crawl_queue SET status = 'processing', claimed_at = unixepoch()
       WHERE id IN (
         SELECT id FROM crawl_queue
         WHERE scan_id = ? AND status = 'pending' AND url_type != 'internal'
         ORDER BY depth, id
         LIMIT ?
       )
       RETURNING id, url, normalized_url, url_type, source_url, depth, anchor_text`
    ).bind(scanId, HEAD_BATCH_SIZE).all(),
  ]);

  const htmlItems = htmlBatch.results || [];
  const headItems = headBatch.results || [];
  const items = [...htmlItems, ...headItems];

  if (items.length === 0) {
    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM crawl_queue
       WHERE scan_id = ? AND status IN ('pending', 'processing')`
    ).bind(scanId).first();
    if (remaining.cnt > 0) {
      return { status: 'running', recentChecks: [] };
    }
    await finalize(env, scan, scanId, siteId);
    return { status: 'complete', recentChecks: [] };
  }

  const pageInserts = [];
  const linkCheckInserts = [];
  const queueInserts = [];
  const seen = new Set();
  let newPages = 0;
  let newLinksChecked = 0;

  async function processHtmlItem(item) {
    const absUrl = item.normalized_url;
    try {
      const { response, responseMs, finalUrl, redirectCount } = await fetchPage(absUrl);
      const contentType = response.headers.get('content-type') || '';
      const statusCode = response.status;
      let title = '';
      let visibleTextLength = 0;
      let links = [];
      let images = [];

      if (isHtmlContentType(contentType) && statusCode < 400) {
        const parsed = await parseHtml(response, LIMITS.maxLinksPerPage, LIMITS.maxImagesPerPage);
        title = parsed.title;
        visibleTextLength = parsed.visibleTextLength;
        links = parsed.links;
        images = parsed.images;
      }

      return { ok: true, statusCode, contentType, title, visibleTextLength, responseMs, finalUrl, redirectCount: redirectCount || 0, links, images, item };
    } catch {
      return { ok: false, statusCode: null, title: '', visibleTextLength: 0, responseMs: 0, finalUrl: absUrl, redirectCount: 0, links: [], images: [], item };
    }
  }

  const htmlResults = await Promise.all(htmlItems.map(processHtmlItem));

  const baseDomain = scan.base_domain;
  let pagesRemaining = Math.max(0, LIMITS.maxPages - pagesCounted);
  let linksRemaining = Math.max(0, LIMITS.maxLinks - linksCounted);

  for (const r of htmlResults) {
    const { item } = r;
    const absUrl = item.normalized_url;
    const newDepth = (item.depth || 1) + 1;

    pageInserts.push(env.DB.prepare(
      `INSERT OR IGNORE INTO pages (scan_id, url, normalized_url, status_code, content_type, title, text_length, response_ms, redirect_count, final_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(scanId, absUrl, absUrl, r.statusCode, r.contentType || '', r.title, r.visibleTextLength, r.responseMs, r.redirectCount, r.finalUrl || absUrl));

    const isBroken = r.statusCode === null || r.statusCode >= 400;
    const isChain = r.redirectCount >= 2;
    if (isBroken || isChain) {
      linkCheckInserts.push(env.DB.prepare(
        `INSERT INTO link_checks (scan_id, source_url, target_url, normalized_target_url, target_type, response_status, redirect_count, final_url, response_ms, anchor_text)
         VALUES (?, ?, ?, ?, 'internal', ?, ?, ?, ?, ?)`
      ).bind(scanId, item.source_url || scan.url, absUrl, absUrl, r.statusCode, r.redirectCount, r.finalUrl || absUrl, r.responseMs, item.anchor_text || ''));
    }

    newPages++;
    newLinksChecked++;
    pagesRemaining--;
    linksRemaining--;

    if (newDepth <= MAX_DEPTH && pagesRemaining > 0) {
      for (const { href, text } of r.links) {
        const norm = normalizeUrl(href, r.finalUrl);
        if (!norm || seen.has(norm) || isTrackingUrl(norm)) continue;
        seen.add(norm);
        try {
          const u = new URL(norm);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
          const isInternal = isInternalUrl(norm, baseDomain);
          const queueNorm = isInternal ? norm : normalizeExternalUrl(norm, r.finalUrl);
          if (!queueNorm) continue;
          if (norm !== queueNorm && seen.has(queueNorm)) continue;
          if (norm !== queueNorm) seen.add(queueNorm);
          if (!isInternal && linksRemaining <= 0) continue;
          queueInserts.push(env.DB.prepare(
            `INSERT OR IGNORE INTO crawl_queue (scan_id, url, normalized_url, url_type, source_url, depth, anchor_text)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(scanId, norm, queueNorm, isInternal ? 'internal' : 'external', absUrl, newDepth, text || ''));
        } catch { /* skip */ }
      }
    }
    if (newDepth <= MAX_DEPTH && linksRemaining > 0) {
      for (const { src, alt } of r.images) {
        const norm = normalizeImageUrl(src, r.finalUrl);
        if (!norm || seen.has(norm) || isTrackingUrl(norm)) continue;
        seen.add(norm);
        try {
          const u = new URL(norm);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
          queueInserts.push(env.DB.prepare(
            `INSERT OR IGNORE INTO crawl_queue (scan_id, url, normalized_url, url_type, source_url, depth, anchor_text)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(scanId, norm, norm, 'image', absUrl, newDepth, alt || ''));
        } catch { /* skip */ }
      }
    }
  }

  let headResults = [];
  if (headItems.length > 0) {
    headResults = await checkBatch(headItems.map(i => ({
      url: i.url,
      normalized_url: i.normalized_url,
      url_type: i.url_type,
      source_url: i.source_url || scan.url,
      anchor_text: i.anchor_text || '',
    })));
    for (const r of headResults) {
      newLinksChecked++;
      const isFailed = r.status === null || (r.status >= 400 && !BOT_BLOCKED_STATUSES.has(r.status));
      const isChain = (r.redirectCount ?? 0) >= 2;
      if (isFailed || isChain) {
        linkCheckInserts.push(env.DB.prepare(
          `INSERT INTO link_checks (scan_id, source_url, target_url, normalized_target_url, target_type, response_status, redirect_count, final_url, response_ms, anchor_text)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(scanId, r.source_url || scan.url, r.url, r.normalized_url, r.url_type, r.status, r.redirectCount || 0, r.finalUrl || r.url, r.responseMs || 0, r.anchor_text || ''));
      }
    }
  }

  const recentChecks = [
    ...htmlResults.map(r => ({ url: r.item.normalized_url, type: 'internal', status: r.statusCode, ms: r.responseMs })),
    ...headResults.map(r => ({ url: r.url, type: r.url_type, status: r.status, ms: r.responseMs || 0 })),
  ].slice(-20);

  const doneUpdates = items.map(i =>
    env.DB.prepare(`UPDATE crawl_queue SET status = 'done' WHERE id = ?`).bind(i.id)
  );

  const hasExternal = headItems.some(i => i.url_type === 'external');
  const hasImages = headItems.some(i => i.url_type === 'image');
  let currentStep = 'Checking internal pages';
  if (htmlItems.length === 0 && hasExternal) currentStep = 'Checking external links';
  else if (htmlItems.length === 0 && hasImages) currentStep = 'Checking images';
  else if (htmlItems.length > 0) currentStep = 'Crawling pages';

  await batchAll(env, [
    ...pageInserts,
    ...linkCheckInserts,
    ...doneUpdates,
    ...queueInserts,
    env.DB.prepare(
      `UPDATE scans SET pages_crawled = pages_crawled + ?, links_checked = links_checked + ?, current_step = ? WHERE id = ?`
    ).bind(newPages, newLinksChecked, currentStep, scanId),
  ]);

  return { status: 'running', recentChecks };
}
