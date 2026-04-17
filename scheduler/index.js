import { bootstrapScan }   from '../functions/_lib/scan-bootstrap.js';
import { processBatch }    from '../functions/_lib/scan-engine.js';
import { sendReportEmail } from './email.js';
import { generateReport }  from '../functions/_lib/report.js';
import { generateId }      from '../functions/_lib/constants.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([
      launchDueScans(env),
      enforceGracePeriods(env),
    ]));
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
     WHERE next_scan_at <= ? AND pending_scan_id IS NULL AND paused = 0 LIMIT 100`
  ).bind(now).all();

  for (const site of due.results) {
    const scanId = generateId();
    const now = Math.floor(Date.now() / 1000);

    // Pre-insert a scan stub so the FK on monitored_sites.pending_scan_id is satisfied
    // before we set it. bootstrapScan will upsert over this stub with real data.
    await env.DB.prepare(
      `INSERT INTO scans (id, url, normalized_start_url, base_domain, site_id, status, started_at, current_step)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, 'Queued')`
    ).bind(scanId, site.url, site.url, site.base_domain, site.id, now).run();

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
      await bootstrapScan(env, scanId, site.url, site.base_domain, site.id);
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

  // Loop up to MAX_LOOPS processBatch calls per invocation.
  // Hard cap keeps worst-case subrequests under 1,000 (4 × ~200).
  // Wall-clock deadline is a secondary guard for slow/redirect-heavy sites.
  const MAX_LOOPS   = 4;
  const WALL_BUDGET = 25_000; // ms
  const deadline    = Date.now() + WALL_BUDGET;

  try {
    for (let i = 0; i < MAX_LOOPS && Date.now() < deadline; i++) {
      const { status } = await processBatch(env, scanId, siteId);

      if (status === 'complete') {
        await onScanComplete(env, msg, scanId, siteId);
        return;
      }
      if (status === 'failed') {
        await releaseSite(env, siteId, 'failed', 'Scan failed during processing');
        msg.ack();
        return;
      }
      // status === 'running' → loop again within this invocation
    }

    // Budget exhausted — send a new message (resets retry counter to 0) instead of
    // retry (which consumes from the 100-retry cap). Allows unlimited total batches.
    await env.SCAN_QUEUE.send({ scanId, siteId });
    msg.ack();

  } catch (err) {
    console.error(`Scan error [${scanId}]:`, err);
    // Unexpected errors use retry so failed messages land in the DLQ after 100 attempts
    msg.retry({ delaySeconds: 10 });
  }
}

/**
 * Grace period enforcement: runs every cron tick.
 * - Pause sites for users whose grace_period_ends_at has passed.
 * - Delete sites + subscription for users whose payment_failed_at was 30+ days ago.
 */
async function enforceGracePeriods(env) {
  const now = Math.floor(Date.now() / 1000);

  // Find users past their grace period deadline
  const expired = await env.DB.prepare(
    `SELECT user_id, payment_failed_at FROM user_subscriptions
     WHERE grace_period_ends_at IS NOT NULL
       AND grace_period_ends_at < ?
       AND status = 'grace_period'`
  ).bind(now).all();

  for (const row of (expired.results || [])) {
    // Pause all their sites
    await env.DB.prepare(
      `UPDATE monitored_sites SET paused = 1 WHERE user_id = ? AND paused = 0`
    ).bind(row.user_id).run();

    await env.DB.prepare(
      `UPDATE user_subscriptions SET status = 'suspended', updated_at = ? WHERE user_id = ?`
    ).bind(now, row.user_id).run();
  }

  // Delete sites + subscription for users who have been suspended for 30+ days
  const deletable = await env.DB.prepare(
    `SELECT user_id FROM user_subscriptions
     WHERE status IN ('suspended', 'cancelled')
       AND payment_failed_at IS NOT NULL
       AND payment_failed_at < ?`
  ).bind(now - 30 * 86400).all();

  for (const row of (deletable.results || [])) {
    await env.DB.prepare(`DELETE FROM monitored_sites WHERE user_id = ?`).bind(row.user_id).run();
    await env.DB.prepare(`DELETE FROM user_subscriptions WHERE user_id = ?`).bind(row.user_id).run();
  }
}

async function onScanComplete(env, msg, scanId, siteId) {
  // Generate report with live suppression overlay (siteId ensures suppressions apply to email)
  const report = await generateReport(env, scanId, null, null, null, siteId);
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
