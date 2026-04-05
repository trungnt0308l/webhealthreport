/**
 * GET /api/scans/:id/report
 * Returns the report for a completed scan, with live suppression/history overlay
 * when the scan belongs to a monitored site.
 */
import { generateReport } from '../../../_lib/report.js';
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

  const scan = await env.DB.prepare(
    `SELECT status, site_id FROM scans WHERE id = ?`
  ).bind(scanId).first();

  if (!scan) {
    return corsResponse(request, env, JSON.stringify({ error: 'Not found' }), { status: 404 });
  }

  if (scan.status !== 'complete') {
    return corsResponse(request, env, JSON.stringify({ error: 'Report not ready', status: scan.status }), { status: 202 });
  }

  const siteId = scan.site_id || null;

  // For monitored-site reports, always apply live suppression overlay (skip cache for response)
  // For one-off scans, use cached report if available
  if (!siteId) {
    const cached = await env.DB.prepare(
      `SELECT rendered_summary_json FROM reports WHERE scan_id = ? AND report_type = 'browser'`
    ).bind(scanId).first();

    if (cached?.rendered_summary_json) {
      return corsResponse(request, env, cached.rendered_summary_json);
    }
  }

  // Generate (or regenerate with live overlay for monitored sites)
  const summary = await generateReport(env, scanId, null, null, null, siteId);
  return corsResponse(request, env, JSON.stringify(summary));
}
