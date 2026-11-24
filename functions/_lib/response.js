/**
 * Shared CORS-aware response helpers for API endpoint functions.
 */
import { getAllowedOrigin } from './cors.js';

/**
 * Return a JSON response with CORS headers.
 * @param {Request} request
 * @param {*} env
 * @param {*} data      — serialisable value
 * @param {number} status — HTTP status code (default 200)
 */
export function corsJson(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Vary': 'Origin',
    },
  });
}

/**
 * Return a preflight OPTIONS response with CORS headers.
 * @param {Request} request
 * @param {*} env
 * @param {string} methods — comma-separated list of allowed methods
 */
export function corsOptions(request, env, methods = 'GET, POST, OPTIONS') {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
