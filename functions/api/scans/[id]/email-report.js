/**
 * POST /api/scans/:id/email-report
 * Sends the completed scan report to the given email address and stores the
 * address as a marketing lead for follow-up.
 * No authentication required — works for anonymous free-scan users.
 */
import { corsJson, corsOptions } from '../../../_lib/response.js';
import { EMAIL_RE } from '../../../_lib/constants.js';
import { generateReport } from '../../../_lib/report.js';
import { sendOneOffReportEmail } from '../../../_lib/email.js';

export async function onRequestPost({ params, request, env }) {
  const { id: scanId } = params;

  let body;
  try { body = await request.json(); }
  catch { return corsJson(request, env, { error: 'Invalid request body' }, 400); }

  const email = (body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return corsJson(request, env, { error: 'Please enter a valid email address' }, 400);
  }

  const scan = await env.DB.prepare(
    'SELECT status, site_id FROM scans WHERE id = ?'
  ).bind(scanId).first();

  if (!scan) return corsJson(request, env, { error: 'Report not found' }, 404);
  if (scan.status !== 'complete') {
    return corsJson(request, env, { error: 'Report not ready yet' }, 202);
  }

  // Use cached report for one-off scans; generate for monitored sites (live overlay)
  let report;
  if (!scan.site_id) {
    const cached = await env.DB.prepare(
      `SELECT rendered_summary_json FROM reports WHERE scan_id = ? AND report_type = 'browser'`
    ).bind(scanId).first();
    if (cached?.rendered_summary_json) {
      report = JSON.parse(cached.rendered_summary_json);
    }
  }
  if (!report) {
    report = await generateReport(env, scanId, null, null, null, scan.site_id || null);
  }

  try {
    await sendOneOffReportEmail(env, email, report);
  } catch (err) {
    console.error('Email send failed:', err.message);
    return corsJson(request, env, { error: 'Failed to send email. Please try again.' }, 502);
  }

  // Store lead — fire-and-forget, don't fail the request on DB error
  env.DB.prepare(
    'INSERT INTO report_leads (scan_id, email, sent_at) VALUES (?, ?, ?)'
  ).bind(scanId, email, Math.floor(Date.now() / 1000)).run().catch(err => {
    console.error('Lead store failed:', err.message);
  });

  return corsJson(request, env, { ok: true });
}

export function onRequestOptions({ request, env }) {
  return corsOptions(request, env, 'POST, OPTIONS');
}
