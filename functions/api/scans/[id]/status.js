/**
 * GET /api/scans/:id/status
 * Returns current progress. Also processes a batch of pending queue items.
 */
import { processBatch } from '../../../_lib/scan-engine.js';
import { getAllowedOrigin } from '../../../_lib/cors.js';

function corsResponse(request, env, body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Access-Control-Allow-Origin', getAllowedOrigin(request, env));
  headers.set('Content-Type', 'application/json');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(body, { ...init, headers });
}

export async function onRequestGet({ params, request, env }) {
  const { id: scanId } = params;

  const scan = await env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(scanId).first();
  if (!scan) {
    return corsResponse(request, env, JSON.stringify({ error: 'Scan not found' }), { status: 404 });
  }

  let recentChecks = [];
  if (scan.status !== 'complete' && scan.status !== 'failed') {
    const result = await processBatch(env, scanId);
    recentChecks = result.recentChecks || [];
  }

  const updated = await env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(scanId).first();
  const resp = await buildProgressResponse(env, updated, recentChecks);
  return corsResponse(request, env, JSON.stringify(resp));
}

async function buildProgressResponse(env, scan, recentChecks = []) {
  let pendingCount = 0;
  if (scan.status === 'running') {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS cnt FROM crawl_queue WHERE scan_id = ? AND status = 'pending'`
    ).bind(scan.id).first();
    pendingCount = row?.cnt ?? 0;
  }

  return {
    scanId: scan.id,
    url: scan.url,
    status: scan.status,
    currentStep: scan.current_step,
    pagesCrawled: scan.pages_crawled || 0,
    linksChecked: scan.links_checked || 0,
    issuesFound: scan.issues_found || 0,
    pendingCount,
    startedAt: scan.started_at,
    finishedAt: scan.finished_at || null,
    recentChecks,
    liveErrors: [],
  };
}
