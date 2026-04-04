const BASE = '/api';

export async function startScan(url) {
  const res = await fetch(`${BASE}/scans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to start scan');
  }
  return res.json();
}

export async function getScanStatus(scanId) {
  const res = await fetch(`${BASE}/scans/${scanId}/status`);
  if (!res.ok) throw new Error('Failed to fetch status');
  return res.json();
}

export async function getScanReport(scanId) {
  const res = await fetch(`${BASE}/scans/${scanId}/report`);
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

export async function removeMonitoredSite(key, id) {
  const res = await fetch(`${BASE}/monitored-sites/${id}`, {
    method: 'DELETE',
    headers: bearerHeaders(key),
  });
  if (res.status === 403) throw Object.assign(new Error('Access denied'), { status: 403 });
  if (!res.ok) throw new Error('Failed to remove site');
  return res.json();
}
