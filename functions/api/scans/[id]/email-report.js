import { parseJson } from '../../../_lib/request.js';
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
import { accessibleScan } from '../../../_lib/scan-access.js';
import { trustedOrigin } from '../../../_lib/request.js';
import { validMailDomain } from '../../../_lib/mail-domain.js';

export async function onRequestPost({ params, request, env }) {
  const { id: scanId } = params;
  if (!trustedOrigin(request, env)) return corsJson(request, env, { error: 'Forbidden origin' }, 403);
  const scan = await accessibleScan(request, env, scanId);
  if (!scan) return corsJson(request, env, { error: 'Report not found' }, 404);
  // Sending private monitored reports to arbitrary recipients is not a product flow.
  if (scan.access_scope !== 'public') return corsJson(request, env, { error: 'Not found' }, 404);

  let body;
  try { body = await parseJson(request); }
  catch { return corsJson(request, env, { error: 'Invalid request body' }, 400); }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    return corsJson(request, env, { error: 'Please enter a valid email address' }, 400);
  }
  try {
    if (!await validMailDomain(email)) return corsJson(request, env, { error: 'Email domain does not accept mail' }, 400);
  } catch { return corsJson(request, env, { error: 'Email verification unavailable' }, 503); }

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
    report = await generateReport(env, scanId, scan, null, null, scan.site_id || null);
  }

  try {
    await sendOneOffReportEmail(env, email, report);
  } catch (err) {
    console.error('Email send failed', err.code || err.name);
    return corsJson(request, env, { error: 'Failed to send email. Please try again.' }, 502);
  }

  // Store lead — fire-and-forget, don't fail the request on DB error
  await env.DB.prepare(
    'INSERT INTO report_leads (scan_id, email, sent_at) VALUES (?, ?, ?)'
  ).bind(scanId, email, Math.floor(Date.now() / 1000)).run().catch(err => {
    console.error('Lead store failed', err.code || err.name);
  });

  return corsJson(request, env, { ok: true });
}

export function onRequestOptions({ request, env }) {
  return corsOptions(request, env, 'POST, OPTIONS');
}
