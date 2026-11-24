import { readLimited } from './network.js';

export function trustedOrigin(request, env) {
  const allowed = env.ALLOWED_ORIGIN || 'https://webhealthreport.pages.dev';
  const origin = request.headers.get('Origin');
  if (origin !== null) return origin === allowed;
  try { return new URL(request.headers.get('Referer')).origin === allowed; } catch { return false; }
}

export async function parseJson(request) {
  const signal = AbortSignal.timeout(5000);
  const bytes = await readLimited(request, 16384, signal);
  const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object required');
  return body;
}

export function isWrite(request) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
}
