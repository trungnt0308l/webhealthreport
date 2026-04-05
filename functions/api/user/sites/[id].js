/**
 * PATCH  /api/user/sites/:id — update emails for a monitored site owned by the authenticated user
 * DELETE /api/user/sites/:id — remove a monitored site owned by the authenticated user
 *
 * The WHERE user_id = ? clause ensures users cannot modify each other's sites,
 * even if they guess the ID. Returns 404 for both "not found" and "not yours".
 */
import { requireAuth, json } from '../../../_lib/auth.js';
import { getAllowedOrigin } from '../../../_lib/cors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const onRequestOptions = ({ request, env }) =>
  new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'Access-Control-Allow-Methods': 'DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });

export const onRequestPatch = requireAuth(async ({ params, request, env, data }) => {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const emails = body.emails;
  if (!Array.isArray(emails) || emails.length === 0) return json({ error: 'emails must be a non-empty array' }, 400);
  const invalid = emails.find(e => typeof e !== 'string' || !EMAIL_RE.test(e.trim()));
  if (invalid !== undefined) return json({ error: 'Invalid email: ' + invalid }, 400);

  const { id } = params;
  const result = await env.DB.prepare(
    'UPDATE monitored_sites SET emails = ? WHERE id = ? AND user_id = ?'
  ).bind(JSON.stringify(emails), id, data.user.id).run();

  if (result.meta?.changes === 0) return json({ error: 'Site not found' }, 404);
  return json({ ok: true });
});

export const onRequestDelete = requireAuth(async ({ params, env, data }) => {
  const { id } = params;

  const result = await env.DB.prepare(
    `DELETE FROM monitored_sites WHERE id = ? AND user_id = ?`
  ).bind(id, data.user.id).run();

  if (result.meta?.changes === 0) {
    return json({ error: 'Site not found' }, 404);
  }

  return json({ ok: true });
});
