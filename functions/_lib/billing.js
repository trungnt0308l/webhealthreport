import * as paypal from './paypal.js';

// Caller holds the user's billing lock. Persist intent before talking to PayPal,
// so a timeout or abandoned browser retains a visible, resumable change.
export async function resumeQuantityChange(env, userId, sub) {
  const target = sub.pending_quantity;
  let provider = await paypal.getSubscription(env, sub.paypal_subscription_id);
  if (provider.status !== 'ACTIVE') throw new Error('Subscription is not active');
  if (Number(provider.quantity || '1') === target) {
    await env.DB.prepare('UPDATE user_subscriptions SET pending_quantity = NULL, pending_approval_url = NULL WHERE user_id = ?').bind(userId).run();
    return { ok: true, confirmed: true };
  }
  let approveUrl = sub.pending_approval_url;
  if (!approveUrl) {
    const revision = await paypal.reviseSubscription(env, sub.paypal_subscription_id, target);
    approveUrl = paypal.approvalUrl(revision);
    await env.DB.prepare('UPDATE user_subscriptions SET pending_approval_url = ? WHERE user_id = ?').bind(approveUrl, userId).run();
    provider = await paypal.getSubscription(env, sub.paypal_subscription_id);
    if (provider.status === 'ACTIVE' && Number(provider.quantity || '1') === target) {
      await env.DB.prepare('UPDATE user_subscriptions SET pending_quantity = NULL, pending_approval_url = NULL WHERE user_id = ?').bind(userId).run();
      return { ok: true, confirmed: true };
    }
  }
  return { pendingApproval: true, approveUrl };
}
