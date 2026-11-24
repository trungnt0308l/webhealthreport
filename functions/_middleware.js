import { json } from './_lib/auth.js';
import { trustedOrigin, isWrite } from './_lib/request.js';
import { rateLimit } from './_lib/rate-limit.js';

// Exact, case-sensitive route inventory. Pages matches against this same URL pathname.
// Reject aliases rather than decoding paths a second time with different semantics.
const routes = [
  [/^\/api\/scans\/?$/, ['POST', 'OPTIONS']],
  [/^\/api\/scans\/[a-zA-Z0-9-]+\/(?:status|report)\/?$/, ['GET', 'OPTIONS']],
  [/^\/api\/scans\/[a-zA-Z0-9-]+\/email-report\/?$/, ['POST', 'OPTIONS']],
  [/^\/api\/monitored-sites\/?$/, ['GET', 'POST', 'OPTIONS']],
  [/^\/api\/monitored-sites\/[a-zA-Z0-9-]+\/suppressions\/?$/, ['POST', 'DELETE', 'OPTIONS']],
  [/^\/api\/monitored-sites\/(?!scan\/?$)[a-zA-Z0-9-]+\/?$/, ['PATCH', 'DELETE', 'OPTIONS']],
  [/^\/api\/user\/sites\/?$/, ['GET', 'OPTIONS']],
  [/^\/api\/user\/sites\/[a-zA-Z0-9-]+\/suppressions\/?$/, ['POST', 'DELETE', 'OPTIONS']],
  [/^\/api\/user\/sites\/[a-zA-Z0-9-]+\/?$/, ['PATCH', 'DELETE', 'OPTIONS']],
  [/^\/api\/paypal\/subscription\/?$/, ['GET', 'POST', 'DELETE', 'OPTIONS']],
  [/^\/api\/paypal\/(?:subscription\/activate|order\/(?:create|capture)|webhook)\/?$/, ['POST', 'OPTIONS']],
];

export async function onRequest(ctx) {
  const { request, env } = ctx;
  const path = new URL(request.url).pathname;
  const isApi = /^\/api(?:\/|$)/i.test(path);
  let response;
  try {
    if (/[%\\]|\/\//.test(path)) response = json({ error: 'Not found' }, 404);
    else if (isApi) {
      const route = routes.find(([pattern]) => pattern.test(path));
      if (!route || /[%\\]|\/\//.test(path)) response = json({ error: 'Not found' }, 404);
      else if (!route[1].includes(request.method)) response = json({ error: 'Method not allowed' }, 405);
      else if (isWrite(request) && !/^\/api\/paypal\/webhook\/?$/.test(path) && !trustedOrigin(request, env)) response = json({ error: 'Forbidden origin' }, 403);
      else {
        const bucket = /^\/api\/monitored-sites/.test(path) ? ['admin', 30] :
          (request.method === 'POST' && /^\/api\/scans\/?$/.test(path)) ? ['scan', 5] :
          (request.method === 'POST' && path.includes('/email-report')) ? ['email', 3] :
          (isWrite(request) && path.startsWith('/api/paypal/') && !path.includes('/webhook')) ? ['billing', 20] : null;
        if (bucket && !await rateLimit(request, env, ...bucket)) {
          response = json({ error: 'Too many requests' }, 429);
          response.headers.set('Retry-After', '60');
        } else response = await ctx.next();
      }
      // Unknown/unsupported API paths must never fall through to the SPA shell.
      if (response.headers.get('content-type')?.includes('text/html')) response = json({ error: 'Not found' }, 404);
    } else response = await ctx.next();
  } catch {
    response = json({ error: 'Request could not be completed' }, 500);
  }
  const secured = new Response(response.body, response);
  secured.headers.set('X-Content-Type-Options', 'nosniff');
  secured.headers.set('X-Frame-Options', 'DENY');
  secured.headers.set('Referrer-Policy', 'no-referrer');
  if (isApi || /^\/(?:report|scan|account|monitor|register)(?:\/|$)/i.test(path)) {
    secured.headers.set('Cache-Control', 'no-store');
    secured.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return secured;
}
