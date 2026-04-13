/**
 * PayPal REST API client for Cloudflare Workers.
 * Uses fetch() — no Node.js SDK required.
 * Access token is cached in Worker globalThis (per-isolate, reused across requests).
 */

// In-memory token cache: survives for the Worker isolate lifetime
let _tokenCache = null;

async function getAccessToken(env) {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 60_000) {
    return _tokenCache.token;
  }
  const creds = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${env.PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal auth failed ${res.status}: ${text}`);
  }
  const data = await res.json();
  _tokenCache = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return _tokenCache.token;
}

async function paypalFetch(env, method, path, body = null) {
  const token = await getAccessToken(env);
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(`${env.PAYPAL_BASE_URL}${path}`, opts);

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
  return paypalFetch(env, 'GET', `/v1/billing/subscriptions/${subscriptionId}`);
}

/**
 * Update subscription quantity — takes effect at next renewal cycle.
 * PayPal prorates nothing; our order/create+capture handles mid-cycle charges.
 */
export async function reviseSubscription(env, subscriptionId, quantity) {
  return paypalFetch(env, 'POST', `/v1/billing/subscriptions/${subscriptionId}/revise`, {
    plan_id: env.PAYPAL_PLAN_ID,
    quantity: String(quantity),
  });
}

/** Cancel a subscription. 204 = success, 422 = already cancelled — both are OK. */
export async function cancelSubscription(env, subscriptionId, reason = 'User cancelled') {
  const token = await getAccessToken(env);
  const res = await fetch(
    `${env.PAYPAL_BASE_URL}/v1/billing/subscriptions/${subscriptionId}/cancel`,
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
  return paypalFetch(env, 'POST', `/v2/checkout/orders/${orderId}/capture`, {});
}

/**
 * Verify a PayPal webhook signature.
 * rawBody MUST be the raw request body string (not re-serialised JSON).
 */
export async function verifyWebhookSignature(env, request, rawBody) {
  const token = await getAccessToken(env);
  const payload = {
    auth_algo:         request.headers.get('paypal-auth-algo'),
    cert_url:          request.headers.get('paypal-cert-url'),
    transmission_id:   request.headers.get('paypal-transmission-id'),
    transmission_sig:  request.headers.get('paypal-transmission-sig'),
    transmission_time: request.headers.get('paypal-transmission-time'),
    webhook_id:        env.PAYPAL_WEBHOOK_ID,
    webhook_event:     JSON.parse(rawBody),
  };
  const res = await fetch(
    `${env.PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) return false;
  const data = await res.json();
  return data.verification_status === 'SUCCESS';
}
