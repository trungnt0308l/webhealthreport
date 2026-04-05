/**
 * Shared CORS origin helper.
 * Returns the allowed origin for a given request, restricted to the app's own domain.
 * Reflects the request origin if it matches the configured ALLOWED_ORIGIN or is localhost.
 */
export function getAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || 'https://webhealthreport.pages.dev';
  if (origin === allowed || origin.startsWith('http://localhost')) return origin;
  return allowed;
}
