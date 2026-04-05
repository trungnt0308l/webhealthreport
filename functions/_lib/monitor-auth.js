/**
 * Shared admin authentication for monitored-sites endpoints.
 * Uses constant-time comparison to avoid timing attacks on the MONITOR_SECRET.
 */

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const aB = enc.encode(a);
  const bB = enc.encode(b);
  // Always compare full length to avoid length oracle
  let result = aB.length !== bB.length ? 1 : 0;
  const len = Math.max(aB.length, bB.length);
  for (let i = 0; i < len; i++) {
    result |= (aB[i] ?? 0) ^ (bB[i] ?? 0);
  }
  return result === 0;
}

/**
 * Returns a 403 Response if the request lacks a valid MONITOR_SECRET Bearer token,
 * or null if authentication passes.
 */
export function adminAuthCheck(request, env, jsonFn) {
  const auth = request.headers.get('Authorization') || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!key || !env.MONITOR_SECRET || !timingSafeEqual(key, env.MONITOR_SECRET)) {
    return jsonFn({ error: 'Access denied' }, 403);
  }
  return null;
}
