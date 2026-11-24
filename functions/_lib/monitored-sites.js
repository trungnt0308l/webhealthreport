/**
 * Remove a monitoring job while preserving scans and their reports.
 * Passing an owner scopes every write to that user; omitting it is admin-only.
 */
export async function deleteMonitoredSite(db, id, owner = null) {
  const where = owner === null ? 'id = ?' : 'id = ? AND user_id = ?';
  const values = owner === null ? [id] : [id, owner.userId];

  // D1 batches are transactions: no scan can be reattached between these writes,
  // and a failed delete rolls back detachment. Site history/suppressions cascade.
  const [, deleted] = await db.batch([
    db.prepare(`UPDATE scans SET site_id = NULL
      WHERE site_id IN (SELECT id FROM monitored_sites WHERE ${where})`).bind(...values),
    db.prepare(`DELETE FROM monitored_sites WHERE ${where}`).bind(...values),
  ]);

  return deleted.meta.changes > 0;
}
