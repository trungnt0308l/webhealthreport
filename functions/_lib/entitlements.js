export const ENTITLEMENT_SQL = `(ms.user_id IS NULL OR us.status = 'active' OR
  (us.status IN ('grace_period', 'cancelled', 'suspended') AND us.grace_period_ends_at > unixepoch()))`;

export async function monitoringAllowed(db, siteId) {
  const site = await db.prepare(`SELECT ms.id, (ms.paused = 0 AND ${ENTITLEMENT_SQL}) AS allowed
    FROM monitored_sites ms LEFT JOIN user_subscriptions us ON us.user_id = ms.user_id
    WHERE ms.id = ?`).bind(siteId).first();
  // Detached in-flight scans may finish their retained report, but cannot email a removed site.
  return site ? site.allowed === 1 : true;
}
