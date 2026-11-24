import { json } from './auth.js';

// Serialize all user billing writes across Pages isolates. The five-minute lease
// exceeds this flow's bounded provider calls; abandoned requests cannot lock forever.
export async function acquireBillingLock(db, userId) {
  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const lock = await db.prepare(`INSERT INTO billing_locks (user_id, token, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
    WHERE billing_locks.expires_at <= ? RETURNING token`).bind(userId, token, now + 300, now).first();
  if (!lock) return null;
  return () => db.prepare('DELETE FROM billing_locks WHERE user_id = ? AND token = ?').bind(userId, token).run();
}

export function withBillingLock(handler, busyStatus = 409) {
  return async ctx => {
    const release = await acquireBillingLock(ctx.env.DB, ctx.data.user.id);
    if (!release) return json({ error: 'A billing change is in progress. Please retry shortly.' }, busyStatus);
    try { return await handler(ctx); }
    finally { await release(); }
  };
}

export async function pendingAddition(db, userId) {
  return db.prepare(`SELECT order_id FROM paypal_pending_orders
    WHERE user_id = ? AND captured_at IS NOT NULL AND activation_state = 'pending' LIMIT 1`).bind(userId).first();
}
