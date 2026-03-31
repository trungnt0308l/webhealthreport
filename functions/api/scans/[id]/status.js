/**
 * GET /api/scans/:id/status
 * Returns current progress. Also processes a batch of pending queue items.
 *
 * Optimized for Cloudflare Workers CPU limits:
 * - All network I/O runs in parallel (fetch doesn't count toward CPU)
 * - ALL D1 writes collected first, then a single batchAll at the end
 * - No individual await DB calls inside loops
 */
import { normalizeUrl, normalizeImageUrl, parseHtml, isInternalUrl, isHtmlContentType } from '../../../_lib/crawl.js';
import { checkBatch, fetchPage } from '../../../_lib/checker.js';
import { detectIssues } from '../../../_lib/issues.js';
import { generateReport } from '../../../_lib/report.js';

const HTML_BATCH_SIZE = 1;   // one full page fetch+parse per poll — CPU budget is tight
const HEAD_BATCH_SIZE = 5;   // HEAD checks — all run in parallel
const MAX_PAGES = 1000;
const MAX_LINKS = 10000;
const MAX_DEPTH = 5;
const D1_CHUNK = 100;

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', '*');
  return r;
}

async function batchAll(env, stmts) {
  for (let i = 0; i < stmts.length; i += D1_CHUNK) {
    await env.DB.batch(stmts.slice(i, i + D1_CHUNK));
  }
}

export async function onRequestGet({ params, env }) {
  const { id: scanId } = params;

  const scan = await env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(scanId).first();
  if (!scan) {
    return cors(new Response(JSON.stringify({ error: 'Scan not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    }));
  }

  if (scan.status === 'complete' || scan.status === 'failed') {
    const resp = await buildProgressResponse(env, scan);
    return cors(new Response(JSON.stringify(resp), { headers: { 'Content-Type': 'application/json' } }));
  }

  const linksCounted = scan.links_checked || 0;
  const pagesCounted = scan.pages_crawled || 0;

  if (pagesCounted >= MAX_PAGES || linksCounted >= MAX_LINKS) {
    await finalize(env, scan, scanId);
    const updated = await env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(scanId).first();
    const resp = await buildProgressResponse(env, updated);
    return cors(new Response(JSON.stringify(resp), { headers: { 'Content-Type': 'application/json' } }));
  }

  // Claim HTML and HEAD batches in parallel, with separate size limits
  const htmlLimit = pagesCounted < MAX_PAGES ? HTML_BATCH_SIZE : 0;
  const [htmlBatch, headBatch] = await Promise.all([
    htmlLimit > 0
      ? env.DB.prepare(
          `UPDATE crawl_queue SET status = 'processing'
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
      `UPDATE crawl_queue SET status = 'processing'
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
    await finalize(env, scan, scanId);
    const updated = await env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(scanId).first();
    const resp = await buildProgressResponse(env, updated);
    return cors(new Response(JSON.stringify(resp), { headers: { 'Content-Type': 'application/json' } }));
  }

  // Collect ALL db writes here — flushed in a single batchAll at the end
  const pageInserts = [];
  const linkCheckInserts = [];
  const queueInserts = [];
  const seen = new Set();
  let newPages = 0;
  let newLinksChecked = 0;

  // --- HTML pages: all in parallel (network I/O doesn't count toward CPU) ---
  async function processHtmlItem(item) {
    const absUrl = item.normalized_url;
    try {
      const { response, responseMs, finalUrl } = await fetchPage(absUrl);
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

      return { ok: true, statusCode, contentType, title, visibleTextLength, responseMs, finalUrl, links, images, item };
    } catch {
      return { ok: false, statusCode: null, title: '', visibleTextLength: 0, responseMs: 0, finalUrl: absUrl, links: [], images: [], item };
    }
  }

  // All HTML pages fire simultaneously — pure I/O wait, minimal CPU
  const htmlResults = await Promise.all(htmlItems.map(processHtmlItem));

  // Now build DB statements synchronously (no awaits) — CPU-only, fast
  const baseDomain = scan.base_domain;
  for (const r of htmlResults) {
    const { item } = r;
    const absUrl = item.normalized_url;
    const newDepth = (item.depth || 1) + 1;

    pageInserts.push(env.DB.prepare(
      `INSERT OR IGNORE INTO pages (scan_id, url, normalized_url, status_code, content_type, title, text_length, response_ms, redirect_count, final_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).bind(scanId, absUrl, absUrl, r.statusCode, r.contentType || '', r.title, r.visibleTextLength, r.responseMs, r.finalUrl || absUrl));

    linkCheckInserts.push(env.DB.prepare(
      `INSERT INTO link_checks (scan_id, source_url, target_url, normalized_target_url, target_type, response_status, redirect_count, final_url, response_ms, anchor_text)
       VALUES (?, ?, ?, ?, 'internal', ?, 0, ?, ?, ?)`
    ).bind(scanId, item.source_url || scan.url, absUrl, absUrl, r.statusCode, r.finalUrl || absUrl, r.responseMs, item.anchor_text || ''));

    newPages++;
    newLinksChecked++;

    // Queue new links discovered on this page
    if (newDepth <= MAX_DEPTH) {
      for (const { href, text } of r.links) {
        const norm = normalizeUrl(href, absUrl);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        try {
          const u = new URL(norm);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
          const isInternal = isInternalUrl(norm, baseDomain);
          queueInserts.push(env.DB.prepare(
            `INSERT OR IGNORE INTO crawl_queue (scan_id, url, normalized_url, url_type, source_url, depth, anchor_text)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(scanId, norm, norm, isInternal ? 'internal' : 'external', absUrl, newDepth, text || ''));
        } catch { /* skip */ }
      }
      for (const { src, alt } of r.images) {
        const norm = normalizeImageUrl(src, absUrl);
        if (!norm || seen.has(norm)) continue;
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

  // --- HEAD checks: external links + images ---
  if (headItems.length > 0) {
    const results = await checkBatch(headItems.map(i => ({
      url: i.normalized_url,
      normalized_url: i.normalized_url,
      url_type: i.url_type,
      source_url: i.source_url || scan.url,
      anchor_text: i.anchor_text || '',
    })));
    for (const r of results) {
      newLinksChecked++;
      linkCheckInserts.push(env.DB.prepare(
        `INSERT INTO link_checks (scan_id, source_url, target_url, normalized_target_url, target_type, response_status, redirect_count, final_url, response_ms, anchor_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(scanId, r.source_url || scan.url, r.url, r.normalized_url, r.url_type, r.status, r.redirectCount || 0, r.finalUrl || r.url, r.responseMs || 0, r.anchor_text || ''));
    }
  }

  // Mark items done
  const doneUpdates = items.map(i =>
    env.DB.prepare(`UPDATE crawl_queue SET status = 'done' WHERE id = ?`).bind(i.id)
  );

  const hasExternal = headItems.some(i => i.url_type === 'external');
  const hasImages = headItems.some(i => i.url_type === 'image');
  let currentStep = 'Checking internal pages';
  if (htmlItems.length === 0 && hasExternal) currentStep = 'Checking external links';
  else if (htmlItems.length === 0 && hasImages) currentStep = 'Checking images';
  else if (htmlItems.length > 0) currentStep = 'Crawling pages';

  // Single flush — all writes in one batchAll call
  await batchAll(env, [
    ...pageInserts,
    ...linkCheckInserts,
    ...doneUpdates,
    ...queueInserts,
    env.DB.prepare(
      `UPDATE scans SET pages_crawled = pages_crawled + ?, links_checked = links_checked + ?, current_step = ? WHERE id = ?`
    ).bind(newPages, newLinksChecked, currentStep, scanId),
  ]);

  const updated = await env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(scanId).first();
  const resp = await buildProgressResponse(env, updated);
  return cors(new Response(JSON.stringify(resp), { headers: { 'Content-Type': 'application/json' } }));
}

async function finalize(env, scan, scanId) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`UPDATE scans SET current_step = 'Analyzing issues' WHERE id = ?`).bind(scanId).run();

  const pages = await env.DB.prepare('SELECT * FROM pages WHERE scan_id = ?').bind(scanId).all();
  const linkChecks = await env.DB.prepare('SELECT * FROM link_checks WHERE scan_id = ?').bind(scanId).all();
  const issues = detectIssues(scanId, pages.results || [], linkChecks.results || []);

  if (issues.length > 0) {
    await batchAll(env, issues.map(i =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO issues (scan_id, issue_type, severity, fingerprint, title, explanation, recommended_action, affected_count, example_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(i.scan_id, i.issue_type, i.severity, i.fingerprint, i.title, i.explanation, i.recommended_action, i.affected_count, i.example_json)
    ));
  }

  await env.DB.prepare(`UPDATE scans SET current_step = 'Building report' WHERE id = ?`).bind(scanId).run();
  await generateReport(env, scanId);
  await env.DB.prepare(
    `UPDATE scans SET status = 'complete', finished_at = ?, issues_found = ?, current_step = 'Complete' WHERE id = ?`
  ).bind(now, issues.length, scanId).run();
}

async function buildProgressResponse(env, scan) {
  const [recent, errorData] = await Promise.all([
    env.DB.prepare(
      `SELECT target_url, target_type, response_status, response_ms FROM link_checks
       WHERE scan_id = ? ORDER BY id DESC LIMIT 20`
    ).bind(scan.id).all(),
    // During scan: fetch live errors list + count; after complete use issues_found
    scan.status === 'complete'
      ? Promise.resolve(null)
      : env.DB.prepare(
          `SELECT target_url, target_type, response_status, source_url FROM link_checks
           WHERE scan_id = ? AND response_status >= 400
           ORDER BY id DESC LIMIT 50`
        ).bind(scan.id).all(),
  ]);

  const errorsFound = scan.status === 'complete'
    ? (scan.issues_found || 0)
    : (errorData?.results?.length || 0);

  const liveErrors = scan.status !== 'complete'
    ? (errorData?.results || []).map(r => ({
        url: r.target_url,
        type: r.target_type,
        status: r.response_status,
        sourceUrl: r.source_url,
      }))
    : [];

  return {
    scanId: scan.id,
    status: scan.status,
    currentStep: scan.current_step,
    pagesCrawled: scan.pages_crawled || 0,
    linksChecked: scan.links_checked || 0,
    issuesFound: errorsFound,
    errorsAreLive: scan.status !== 'complete',
    startedAt: scan.started_at,
    finishedAt: scan.finished_at || null,
    recentChecks: (recent.results || []).map(r => ({
      url: r.target_url,
      type: r.target_type,
      status: r.response_status,
      ms: r.response_ms,
    })),
    liveErrors,
  };
}
