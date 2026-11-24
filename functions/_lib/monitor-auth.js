/**
 * Shared admin authentication for monitored-sites endpoints.
 * Uses constant-time comparison to avoid timing attacks on the MONITOR_SECRET.
 */

import { trustedOrigin, isWrite } from './request.js';
import { createHash, timingSafeEqual as compare } from 'node:crypto';

function timingSafeEqual(a, b) {
  return compare(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
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
  if (isWrite(request) && !trustedOrigin(request, env)) return jsonFn({ error: 'Forbidden origin' }, 403);
  return null;
}
