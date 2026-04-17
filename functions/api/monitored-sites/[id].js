/**
 * PATCH  /api/monitored-sites/:id — update emails for a monitored site (admin)
 * DELETE /api/monitored-sites/:id — remove a monitored site (admin)
 */
import { adminAuthCheck } from '../../_lib/monitor-auth.js';
import { corsJson, corsOptions } from '../../_lib/response.js';
import { EMAIL_RE } from '../../_lib/constants.js';

const json = corsJson;

export function onRequestOptions({ request, env }) {
  return corsOptions(request, env, 'DELETE, PATCH, OPTIONS');
}

export async function onRequestPatch({ params, request, env }) {
  const denied = adminAuthCheck(request, env, (d, s) => json(request, env, d, s));
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return json(request, env, { error: 'Invalid JSON' }, 400); }

  const emails = body.emails;
  if (!Array.isArray(emails) || emails.length === 0) return json(request, env, { error: 'emails must be a non-empty array' }, 400);
  const invalid = emails.find(e => typeof e !== 'string' || !EMAIL_RE.test(e.trim()));
  if (invalid !== undefined) return json(request, env, { error: 'Invalid email: ' + invalid }, 400);

  const { id } = params;
  const result = await env.DB.prepare(
    'UPDATE monitored_sites SET emails = ? WHERE id = ?'
  ).bind(JSON.stringify(emails), id).run();

  if (result.meta.changes === 0) return json(request, env, { error: 'Site not found' }, 404);
  return json(request, env, { ok: true });
}

export async function onRequestDelete({ params, request, env }) {
  const denied = adminAuthCheck(request, env, (d, s) => json(request, env, d, s));
  if (denied) return denied;

  const { id } = params;
  const result = await env.DB.prepare(
    'DELETE FROM monitored_sites WHERE id = ?'
  ).bind(id).run();

  if (result.meta.changes === 0) {
    return json(request, env, { error: 'Site not found' }, 404);
  }

  return json(request, env, { ok: true });
}
