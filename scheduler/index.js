import { bootstrapScan }   from '../functions/_lib/scan-bootstrap.js';
import { processBatch }    from '../functions/_lib/scan-engine.js';
import { sendReportEmail } from './email.js';
import { generateReport }  from '../functions/_lib/report.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(launchDueScans(env));
  },

  async queue(batch, env) {
    for (const msg of batch.messages) {
      if (msg.body.isDlq) {
        await releaseSite(env, msg.body.siteId, 'failed', 'Max retries exhausted');
        msg.ack();
      } else {
        await runScan(env, msg);
      }
    }
  },
};

/**
 * Release a site's mutex and always advance next_scan_at by 7 days from now.
 * On success, also records last_scan_id and clears any previous error.
 * On failure, records the error message so it's visible in the admin UI.
 *
 * Using unixepoch() + 604800 (not next_scan_at + 604800) ensures the next
 * scan is always ~7 days from now even if next_scan_at was 0 or in the past.
 */
async function releaseSite(env, siteId, status, errorMsg = null, scanId = null) {
  if (status === 'success' && scanId) {
    await env.DB.prepare(
      `UPDATE monitored_sites
       SET pending_scan_id = NULL,
           last_scan_id     = ?,
           last_scan_status = 'success',
           last_scan_error  = NULL,
           next_scan_at     = unixepoch() + 604800
       WHERE id = ?`
    ).bind(scanId, siteId).run();
  } else {
    await env.DB.prepare(
      `UPDATE monitored_sites
       SET pending_scan_id = NULL,
           last_scan_status = 'failed',
           last_scan_error  = ?,
           next_scan_at     = unixepoch() + 604800
       WHERE id = ?`
    ).bind(errorMsg, siteId).run();
  }
}

async function launchDueScans(env) {
  const now = Math.floor(Date.now() / 1000);
  const due = await env.DB.prepare(
    `SELECT id, url, base_domain FROM monitored_sites
     WHERE next_scan_at <= ? AND pending_scan_id IS NULL LIMIT 20`
  ).bind(now).all();

  for (const site of due.results) {
    const scanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const now = Math.floor(Date.now() / 1000);

    // Pre-insert a scan stub so the FK on monitored_sites.pending_scan_id is satisfied
    // before we set it. bootstrapScan will upsert over this stub with real data.
    await env.DB.prepare(
      `INSERT INTO scans (id, url, normalized_start_url, base_domain, status, started_at, current_step)
       VALUES (?, ?, ?, ?, 'pending', ?, 'Queued')`
    ).bind(scanId, site.url, site.url, site.base_domain, now).run();

    // Atomic claim — only one cron invocation wins per site
    const claim = await env.DB.prepare(
      `UPDATE monitored_sites SET pending_scan_id = ?
       WHERE id = ? AND pending_scan_id IS NULL`
    ).bind(scanId, site.id).run();

    if (claim.meta.changes === 0) {
      // Lost the race — clean up the orphan stub
      await env.DB.prepare('DELETE FROM scans WHERE id = ?').bind(scanId).run();
      continue;
    }

    try {
      await bootstrapScan(env, scanId, site.url, site.base_domain);
    } catch (err) {
      console.error(`Bootstrap failed for ${site.url}:`, err);
      await releaseSite(env, site.id, 'failed', `Bootstrap error: ${err.message}`);
      continue;
    }

    await env.SCAN_QUEUE.send({ scanId, siteId: site.id });
  }
}

async function runScan(env, msg) {
  const { scanId, siteId } = msg.body;

  // Abort scans stuck longer than 4 hours (safety valve for infinite re-queue loops)
  const scan = await env.DB.prepare('SELECT started_at FROM scans WHERE id = ?').bind(scanId).first();
  if (scan && (Date.now() / 1000 - scan.started_at) > 4 * 3600) {
    await releaseSite(env, siteId, 'failed', 'Scan timed out after 4 hours');
    msg.ack();
    return;
  }

  // One processBatch call per invocation — keeps subrequest count well within
  // Cloudflare's per-invocation limit.
  try {
    const { status } = await processBatch(env, scanId);

    if (status === 'complete') {
      await onScanComplete(env, msg, scanId, siteId);
      return;
    }
    if (status === 'failed') {
      await releaseSite(env, siteId, 'failed', 'Scan failed during processing');
      msg.ack();
      return;
    }
    // Still running — send a new message (attempts reset to 0) instead of retry
    // (which would consume from the 100-retry cap). This allows unlimited batches.
    await env.SCAN_QUEUE.send({ scanId, siteId });
    msg.ack();

  } catch (err) {
    console.error(`Scan error [${scanId}]:`, err);
    // Unexpected errors use retry so failed messages land in the DLQ after 100 attempts
    msg.retry({ delaySeconds: 10 });
  }
}

async function onScanComplete(env, msg, scanId, siteId) {
  // Ensure report exists (generated during finalize, but regenerate if missing)
  let row = await env.DB.prepare(
    `SELECT rendered_summary_json FROM reports WHERE scan_id = ? AND report_type = 'browser'`
  ).bind(scanId).first();
  if (!row) {
    await generateReport(env, scanId, null, null, null);
    row = await env.DB.prepare(
      `SELECT rendered_summary_json FROM reports WHERE scan_id = ? AND report_type = 'browser'`
    ).bind(scanId).first();
  }

  const report = JSON.parse(row.rendered_summary_json);
  const site   = await env.DB.prepare(`SELECT * FROM monitored_sites WHERE id = ?`).bind(siteId).first();

  // Email failure is logged but never blocks schedule advancement
  try {
    await sendReportEmail(env, site, report);
  } catch (err) {
    console.error(`Email failed for site ${siteId}:`, err);
  }

  await releaseSite(env, siteId, 'success', null, scanId);
  msg.ack();
}
