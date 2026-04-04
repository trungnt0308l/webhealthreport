/**
 * GET /api/scans/:id/status
 * Returns current progress. Also processes a batch of pending queue items.
 */
import { processBatch } from '../../../_lib/scan-engine.js';

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', '*');
  return r;
}

export async function onRequestGet({ params, env }) {
  const { id: scanId } = params;

  const scan = await env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(scanId).first();
  if (!scan) {
    return cors(new Response(JSON.stringify({ error: 'Scan not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    }));
  }

  let recentChecks = [];
  if (scan.status !== 'complete' && scan.status !== 'failed') {
    const result = await processBatch(env, scanId);
    recentChecks = result.recentChecks || [];
  }

  const updated = await env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(scanId).first();
  const resp = await buildProgressResponse(env, updated, recentChecks);
  return cors(new Response(JSON.stringify(resp), { headers: { 'Content-Type': 'application/json' } }));
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
