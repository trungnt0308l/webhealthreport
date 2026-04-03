/**
 * GET /api/scans/:id/report
 * Returns the stored report JSON for a completed scan.
 * Generates it on first fetch if not yet built (deferred from finalize to save CPU).
 */
import { generateReport } from '../../../_lib/report.js';

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', '*');
  return r;
}

export async function onRequestGet({ params, env }) {
  const { id: scanId } = params;

  const report = await env.DB.prepare(
    `SELECT rendered_summary_json FROM reports WHERE scan_id = ? AND report_type = 'browser'`
  ).bind(scanId).first();

  if (report?.rendered_summary_json) {
    return cors(new Response(report.rendered_summary_json, {
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  // No cached report yet — check scan status
  const scan = await env.DB.prepare('SELECT status FROM scans WHERE id = ?').bind(scanId).first();
  if (!scan) {
    return cors(new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    }));
  }

  if (scan.status !== 'complete') {
    return cors(new Response(JSON.stringify({ error: 'Report not ready', status: scan.status }), {
      status: 202, headers: { 'Content-Type': 'application/json' },
    }));
  }

  // Scan is complete but report not yet generated — build it now (lazy, one-time)
  const summary = await generateReport(env, scanId, null, null, null);
  return cors(new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  }));
}
