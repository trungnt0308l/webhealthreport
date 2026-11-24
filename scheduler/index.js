import { bootstrapScan }   from '../functions/_lib/scan-bootstrap.js';
import { processBatch }    from '../functions/_lib/scan-engine.js';
import { sendReportEmail } from './email.js';
import { generateReport }  from '../functions/_lib/report.js';
import { generateId }      from '../functions/_lib/constants.js';
import { deleteMonitoredSite } from '../functions/_lib/monitored-sites.js';
import { ENTITLEMENT_SQL, monitoringAllowed } from '../functions/_lib/entitlements.js';
import { acquireBillingLock } from '../functions/_lib/billing-lock.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([
      launchDueScans(env),
      enforceGracePeriods(env),
      cleanupStuckScans(env),
      env.DB.prepare('DELETE FROM request_limits WHERE window_start < unixepoch() - 3600').run(),
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
    `SELECT ms.id, ms.url, ms.base_domain FROM monitored_sites ms
     LEFT JOIN user_subscriptions us ON us.user_id = ms.user_id
     WHERE ms.next_scan_at <= ? AND ms.pending_scan_id IS NULL AND ms.paused = 0 AND ${ENTITLEMENT_SQL} LIMIT 100`
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
      console.error('Monitoring bootstrap failed', err.code || err.name);
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
  // Hard cap keeps worst-case subrequests under 1,000 (8 × ~120 = ~960).
  // Wall-clock deadline is a secondary guard for slow/redirect-heavy sites.
  const MAX_LOOPS   = 8;
  const WALL_BUDGET = 28_000; // ms
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
    console.error('Monitoring scan failed', err.code || err.name);
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
  const expired = await env.DB.prepare(`SELECT user_id FROM user_subscriptions
    WHERE status IN ('grace_period', 'cancelled', 'suspended')`).all();

  for (const row of (expired.results || [])) {
    const release = await acquireBillingLock(env.DB, row.user_id);
    if (!release) continue;
    try {
      const sub = await env.DB.prepare('SELECT * FROM user_subscriptions WHERE user_id = ?').bind(row.user_id).first();
      if (!sub || sub.status === 'active') continue;
      if (!sub.grace_period_ends_at || sub.grace_period_ends_at <= now) {
        await env.DB.prepare('UPDATE monitored_sites SET paused = 1 WHERE user_id = ?').bind(row.user_id).run();
        if (sub.status === 'grace_period') await env.DB.prepare("UPDATE user_subscriptions SET status = 'suspended', updated_at = ? WHERE user_id = ?").bind(now, row.user_id).run();
      }
      const inactiveSince = sub.payment_failed_at || (sub.grace_period_ends_at ? sub.grace_period_ends_at - 3 * 86400 : null);
      if (inactiveSince !== null && inactiveSince < now - 30 * 86400) {
        const sites = await env.DB.prepare('SELECT id FROM monitored_sites WHERE user_id = ?').bind(row.user_id).all();
        for (const site of sites.results) await deleteMonitoredSite(env.DB, site.id, { userId: row.user_id });
        await env.DB.prepare('DELETE FROM user_subscriptions WHERE user_id = ?').bind(row.user_id).run();
      }
    } finally { await release(); }
  }
}

async function cleanupStuckScans(env) {
  const cutoff = Math.floor(Date.now() / 1000) - 3600; // 1 hour

  const { meta } = await env.DB.prepare(
    `UPDATE scans SET status = 'failed',
     error_message = 'Scan timed out after 1 hour',
     finished_at = unixepoch()
     WHERE status IN ('pending', 'running') AND started_at < ?`
  ).bind(cutoff).run();

  if (meta.changes > 0) {
    await env.DB.prepare(
      `UPDATE monitored_sites SET pending_scan_id = NULL
       WHERE pending_scan_id IN (
         SELECT id FROM scans WHERE status = 'failed'
           AND finished_at >= unixepoch() - 5
       )`
    ).run();
  }
}

async function onScanComplete(env, msg, scanId, siteId) {
  // Generate report with live suppression overlay (siteId ensures suppressions apply to email)
  const report = await generateReport(env, scanId, null, null, null, siteId);
  const site   = await env.DB.prepare(`SELECT * FROM monitored_sites WHERE id = ?`).bind(siteId).first();
  // Removal during a scan retains its report, but ends monitoring and email delivery.
  if (!site) {
    msg.ack();
    return;
  }
  if (!await monitoringAllowed(env.DB, siteId)) {
    await releaseSite(env, siteId, 'failed', 'Monitoring subscription inactive');
    msg.ack();
    return;
  }

  // Email failure is logged but never blocks schedule advancement
  try {
    await sendReportEmail(env, site, report);
  } catch (err) {
    console.error('Monitoring email failed', err.code || err.name);
  }

  await releaseSite(env, siteId, 'success', null, scanId);
  msg.ack();
}
