const BASE = '/api';

export async function startScan(url, turnstileToken) {
  const res = await fetch(`${BASE}/scans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, turnstileToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to start scan');
  }
  return res.json();
}

export async function getScanStatus(scanId, token) {
  const res = await fetch(`${BASE}/scans/${scanId}/status`, { headers: token ? bearerHeaders(token) : {} });
  if (!res.ok) throw new Error('Failed to fetch status');
  return res.json();
}

export async function getScanReport(scanId, token) {
  const res = await fetch(`${BASE}/scans/${scanId}/report`, { headers: token ? bearerHeaders(token) : {} });
  if (res.status === 202) return null; // not ready
  if (!res.ok) throw new Error('Failed to fetch report');
  return res.json();
}

function bearerHeaders(key, extra = {}) {
  return { 'Authorization': `Bearer ${key}`, ...extra };
}

export async function getMonitoredSites(key) {
  const res = await fetch(`${BASE}/monitored-sites`, {
    headers: bearerHeaders(key),
  });
  if (res.status === 403) throw Object.assign(new Error('Access denied'), { status: 403 });
  if (!res.ok) throw new Error('Failed to fetch sites');
  return res.json();
}

export async function addMonitoredSite(key, url, emails) {
  const res = await fetch(`${BASE}/monitored-sites`, {
    method: 'POST',
    headers: bearerHeaders(key, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ url, emails }),
  });
  if (res.status === 403) throw Object.assign(new Error('Access denied'), { status: 403 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to add site');
  }
  return res.json();
}

export async function updateMonitoredSiteEmails(key, id, emails) {
  const res = await fetch(`${BASE}/monitored-sites/${id}`, {
    method: 'PATCH',
    headers: bearerHeaders(key, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ emails }),
  });
  if (res.status === 403) throw Object.assign(new Error('Access denied'), { status: 403 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update emails');
  }
  return res.json();
}

export async function removeMonitoredSite(key, id) {
  const res = await fetch(`${BASE}/monitored-sites/${id}`, {
    method: 'DELETE',
    headers: bearerHeaders(key),
  });
  if (res.status === 403) throw Object.assign(new Error('Access denied'), { status: 403 });
  if (!res.ok) throw new Error('Failed to remove site');
  return res.json();
}

// ── User-scoped site API (Auth0 Bearer token) ──────────────────────────────

export async function getUserSites(token) {
  const res = await fetch(`${BASE}/user/sites`, {
    headers: bearerHeaders(token),
  });
  if (res.status === 401) throw Object.assign(new Error('Not authenticated'), { status: 401 });
  if (!res.ok) throw new Error('Failed to fetch sites');
  return res.json();
}

export async function updateUserSiteEmails(token, id, emails) {
  const res = await fetch(`${BASE}/user/sites/${id}`, {
    method: 'PATCH',
    headers: bearerHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ emails }),
  });
  if (res.status === 401) throw Object.assign(new Error('Not authenticated'), { status: 401 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update emails');
  }
  return res.json();
}

export async function removeUserSite(token, id) {
  const res = await fetch(`${BASE}/user/sites/${id}`, {
    method: 'DELETE',
    headers: bearerHeaders(token),
  });
  if (res.status === 401) throw Object.assign(new Error('Not authenticated'), { status: 401 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(res.status === 409 ? (err.error || 'Billing update in progress') : 'Failed to remove site');
  }
  return res.json();
}

// ── PayPal billing API ─────────────────────────────────────────────────────

export async function getSubscription(token) {
  const res = await fetch(`${BASE}/paypal/subscription`, {
    headers: bearerHeaders(token),
  });
  if (res.status === 401) throw Object.assign(new Error('Not authenticated'), { status: 401 });
  if (!res.ok) throw new Error('Failed to fetch subscription');
  return res.json();
}

export async function createPayPalSubscription(token) {
  const res = await fetch(`${BASE}/paypal/subscription`, {
    method: 'POST',
    headers: bearerHeaders(token, { 'Content-Type': 'application/json' }),
  });
  if (res.status === 401) throw Object.assign(new Error('Not authenticated'), { status: 401 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create subscription');
  }
  return res.json();
}

export async function activateSubscription(token, subscriptionId, url, emails) {
  const res = await fetch(`${BASE}/paypal/subscription/activate`, {
    method: 'POST',
    headers: bearerHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ subscriptionId, url, emails }),
  });
  if (res.status === 401) throw Object.assign(new Error('Not authenticated'), { status: 401 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to activate subscription');
  }
  return res.json();
}

export async function cancelSubscription(token) {
  const res = await fetch(`${BASE}/paypal/subscription`, {
    method: 'DELETE',
    headers: bearerHeaders(token),
  });
  if (res.status === 401) throw Object.assign(new Error('Not authenticated'), { status: 401 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to cancel subscription');
  }
  return res.json();
}

export async function createProRateOrder(token, url, emails) {
  const res = await fetch(`${BASE}/paypal/order/create`, {
    method: 'POST',
    headers: bearerHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ url, emails }),
  });
  if (res.status === 401) throw Object.assign(new Error('Not authenticated'), { status: 401 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create payment');
  }
  return res.json();
}

export async function captureProRateOrder(token, orderId) {
  const res = await fetch(`${BASE}/paypal/order/capture`, {
    method: 'POST',
    headers: bearerHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ orderId }),
  });
  if (res.status === 401) throw Object.assign(new Error('Not authenticated'), { status: 401 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to capture payment');
  }
  return res.json();
}

export async function emailReport(scanId, email) {
  const res = await fetch(`${BASE}/scans/${scanId}/email-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send report');
  }
  return res.json();
}

export async function addSuppression(token, siteId, issueType, targetUrl) {
  const res = await fetch(`${BASE}/user/sites/${siteId}/suppressions`, {
    method: 'POST',
    headers: bearerHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ issueType, targetUrl }),
  });
  if (res.status === 401) throw Object.assign(new Error('Not authenticated'), { status: 401 });
  if (!res.ok) throw new Error('Failed to suppress issue');
  return res.json();
}

