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
