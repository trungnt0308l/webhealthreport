import { serviceFetch, opaqueId } from './network.js';
import { verifyPaypalSignature } from './paypal-signature.js';
import { createHash } from 'node:crypto';

const PAYPAL_HOSTS = ['api-m.paypal.com', 'api-m.sandbox.paypal.com'];
function base(env) {
  if (!['https://api-m.paypal.com', 'https://api-m.sandbox.paypal.com'].includes(env.PAYPAL_BASE_URL)) throw new Error('Invalid PayPal API origin');
  return env.PAYPAL_BASE_URL;
}
function fetchPaypal(url, options) { return serviceFetch(url, options, { hosts: PAYPAL_HOSTS }); }
/**
 * PayPal REST API client for Cloudflare Workers.
 * Uses fetch() — no Node.js SDK required.
 * Access token is cached in Worker globalThis (per-isolate, reused across requests).
 */

// In-memory token cache: survives for the Worker isolate lifetime
const tokenCaches = new Map();

async function getAccessToken(env) {
  const cacheKey = `${base(env)}:${env.PAYPAL_CLIENT_ID}`;
  const _tokenCache = tokenCaches.get(cacheKey);
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 60_000) {
    return _tokenCache.token;
  }
  const creds = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetchPaypal(`${base(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new Error(`PayPal auth failed ${res.status}`);
  }
  const data = await res.json();
  if (tokenCaches.size >= 8) tokenCaches.clear();
  tokenCaches.set(cacheKey, { token: data.access_token, expiresAt: now + data.expires_in * 1000 });
  return data.access_token;
}

async function paypalFetch(env, method, path, body = null, extraHeaders = {}) {
  const token = await getAccessToken(env);
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders },
  };
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetchPaypal(`${base(env)}${path}`, opts);

  if (res.status === 204) return null; // No Content

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    const err = new Error(`PayPal ${method} ${path} failed ${res.status}`);
    err.status = res.status;
    err.paypal = data;
    throw err;
  }
  return data;
}

/**
 * Create a monthly subscription for a user.
 * Sets custom_id = userId so activate.js can verify ownership.
 */
export async function createSubscription(env, userId, quantity, returnUrl, cancelUrl) {
  return paypalFetch(env, 'POST', '/v1/billing/subscriptions', {
    plan_id: env.PAYPAL_PLAN_ID,
    quantity: String(quantity),
    custom_id: userId,
    application_context: {
      brand_name: 'Website Health Report',
      locale: 'en-US',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'SUBSCRIBE_NOW',
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  });
}

/** Fetch full subscription details from PayPal (includes billing_info.next_billing_time). */
export async function getSubscription(env, subscriptionId) {
  return paypalFetch(env, 'GET', `/v1/billing/subscriptions/${opaqueId(subscriptionId)}`);
}

/**
 * Update subscription quantity — takes effect at next renewal cycle.
 * PayPal prorates nothing; our order/create+capture handles mid-cycle charges.
 */
export async function reviseSubscription(env, subscriptionId, quantity, returnPath = '/account?paypal_quantity=1') {
  const origin = env.ALLOWED_ORIGIN || 'https://webhealthreport.pages.dev';
  return paypalFetch(env, 'POST', `/v1/billing/subscriptions/${opaqueId(subscriptionId)}/revise`, {
    plan_id: env.PAYPAL_PLAN_ID,
    quantity: String(quantity),
    application_context: { return_url: origin + returnPath, cancel_url: origin + '/account?paypal_revision_cancelled=1', shipping_preference: 'NO_SHIPPING' },
  });
}

/** Cancel a subscription. 204 = success, 422 = already cancelled — both are OK. */
export async function cancelSubscription(env, subscriptionId, reason = 'User cancelled') {
  const token = await getAccessToken(env);
  const res = await fetchPaypal(
    `${base(env)}/v1/billing/subscriptions/${opaqueId(subscriptionId)}/cancel`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }
  );
  if (res.status === 204 || res.status === 422) return; // OK or already cancelled
  throw new Error(`PayPal cancel failed: ${res.status}`);
}

/**
 * Create a one-time capture order for the prorated mid-cycle charge.
 * Uses v2 Orders API.
 */
export async function createOrder(env, amount, returnUrl, cancelUrl) {
  return paypalFetch(env, 'POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      amount: { currency_code: 'USD', value: String(amount) },
      description: 'Website Health Report — prorated charge for new monitored site',
    }],
    application_context: {
      brand_name: 'Website Health Report',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  });
}

/** Capture an approved v2 order. */
export async function captureOrder(env, orderId) {
  const requestId = createHash('sha256').update(`capture:${opaqueId(orderId)}`).digest('hex').slice(0, 32);
  return paypalFetch(env, 'POST', `/v2/checkout/orders/${opaqueId(orderId)}/capture`, {}, { 'PayPal-Request-Id': requestId });
}

export function getOrder(env, orderId) {
  return paypalFetch(env, 'GET', `/v2/checkout/orders/${opaqueId(orderId)}`);
}

export function approvalUrl(result) {
  const value = result?.links?.find(link => ['approve', 'payer-action'].includes(link.rel))?.href;
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['www.paypal.com', 'www.sandbox.paypal.com', 'paypal.com', 'sandbox.paypal.com'].includes(url.hostname)) throw new Error('Invalid approval URL');
  return url.href;
}

/**
 * Verify a PayPal webhook signature.
 * rawBody MUST be the raw request body string (not re-serialised JSON).
 */
export async function verifyWebhookSignature(env, request, rawBody) {
  return verifyPaypalSignature(env, request, rawBody);
}
