/**
 * GET /api/scans/:id/report
 * Returns the report for a completed scan, with live suppression/history overlay
 * when the scan belongs to a monitored site.
 */
import { generateReport } from '../../../_lib/report.js';
import { corsJson } from '../../../_lib/response.js';
import { getAllowedOrigin } from '../../../_lib/cors.js';

export async function onRequestGet({ params, request, env }) {
  const { id: scanId } = params;

  const scan = await env.DB.prepare(
    `SELECT status, site_id FROM scans WHERE id = ?`
  ).bind(scanId).first();

  if (!scan) {
    return corsJson(request, env, { error: 'Not found' }, 404);
  }

  if (scan.status !== 'complete') {
    return corsJson(request, env, { error: 'Report not ready', status: scan.status }, 202);
  }

  const siteId = scan.site_id || null;

  // For monitored-site reports, always apply live suppression overlay (skip cache for response)
  // For one-off scans, use cached report if available
  if (!siteId) {
    const cached = await env.DB.prepare(
      `SELECT rendered_summary_json FROM reports WHERE scan_id = ? AND report_type = 'browser'`
    ).bind(scanId).first();

    if (cached?.rendered_summary_json) {
      // Return pre-serialized JSON directly to avoid double-serialization
      return new Response(cached.rendered_summary_json, {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
  }

  // Generate (or regenerate with live overlay for monitored sites)
  const summary = await generateReport(env, scanId, null, null, null, siteId);
  return corsJson(request, env, summary);
}
