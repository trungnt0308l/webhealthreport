/**
 * POST /api/monitored-sites/scan — trigger an immediate scan for a monitored site (admin)
 *
 * Auth:  Authorization: Bearer <MONITOR_SECRET>
 * Body:  { url: string }   — must match a monitored site's URL or base_domain
 *
 * Responses:
 *   202 { scanId, siteId }  — scan queued successfully
 *   400 { error }           — missing or invalid URL
 *   404 { error }           — no monitored site found for this URL
 *   409 { error, scanId }   — scan already in progress
 *   423 { error }           — site is paused
 *   500 { error }           — bootstrap failed
 */
import { normalizeUrl, getBaseDomain } from '../../_lib/crawl.js';
import { adminAuthCheck } from '../../_lib/monitor-auth.js';
import { bootstrapScan } from '../../_lib/scan-bootstrap.js';
import { getAllowedOrigin } from '../../_lib/cors.js';

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function onRequestOptions({ request, env }) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function onRequestPost({ request, env }) {
  const denied = adminAuthCheck(request, env, (d, s) => json(request, env, d, s));
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json(request, env, { error: 'Invalid JSON' }, 400);
  }

  const { url: rawUrl } = body;
  if (!rawUrl) return json(request, env, { error: 'url is required' }, 400);

  let startUrl;
  try {
    startUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    new URL(startUrl);
  } catch {
    return json(request, env, { error: 'Invalid URL' }, 400);
  }

  const baseDomain = getBaseDomain(normalizeUrl(startUrl, startUrl) ?? startUrl);

  // Match by base_domain so e.g. "https://example.com/page" finds "https://example.com"
  const site = await env.DB.prepare(
    `SELECT id, url, base_domain, pending_scan_id, paused FROM monitored_sites WHERE base_domain = ? LIMIT 1`
  ).bind(baseDomain).first();

  if (!site) return json(request, env, { error: 'No monitored site found for: ' + baseDomain }, 404);
  if (site.paused) return json(request, env, { error: 'Site is paused' }, 423);
  if (site.pending_scan_id) {
    return json(request, env, { error: 'Scan already in progress', scanId: site.pending_scan_id }, 409);
  }

  const scanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = Math.floor(Date.now() / 1000);

  // Pre-insert scan stub so the FK on monitored_sites.pending_scan_id is satisfied
  await env.DB.prepare(
    `INSERT INTO scans (id, url, normalized_start_url, base_domain, site_id, status, started_at, current_step)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, 'Queued')`
  ).bind(scanId, site.url, site.url, site.base_domain, site.id, now).run();

  // Atomic claim — guard against a race with the cron scheduler
  const claim = await env.DB.prepare(
    `UPDATE monitored_sites SET pending_scan_id = ? WHERE id = ? AND pending_scan_id IS NULL`
  ).bind(scanId, site.id).run();

  if (claim.meta.changes === 0) {
    // Lost the race — clean up the orphan stub
    await env.DB.prepare('DELETE FROM scans WHERE id = ?').bind(scanId).run();
    const current = await env.DB.prepare(
      'SELECT pending_scan_id FROM monitored_sites WHERE id = ?'
    ).bind(site.id).first();
    return json(request, env, { error: 'Scan already in progress', scanId: current?.pending_scan_id ?? null }, 409);
  }

  try {
    await bootstrapScan(env, scanId, site.url, site.base_domain, site.id);
  } catch (err) {
    // Release the claim so the site isn't stuck
    await env.DB.prepare(
      `UPDATE monitored_sites
       SET pending_scan_id = NULL, last_scan_status = 'failed', last_scan_error = ?
       WHERE id = ?`
    ).bind(`Bootstrap error: ${err.message}`, site.id).run();
    await env.DB.prepare('DELETE FROM scans WHERE id = ?').bind(scanId).run();
    return json(request, env, { error: 'Bootstrap failed: ' + err.message }, 500);
  }

  await env.SCAN_QUEUE.send({ scanId, siteId: site.id });

  return json(request, env, { scanId, siteId: site.id }, 202);
}
