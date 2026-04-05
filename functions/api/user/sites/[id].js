/**
 * DELETE /api/user/sites/:id — remove a monitored site owned by the authenticated user
 *
 * The WHERE user_id = ? clause ensures users cannot delete each other's sites,
 * even if they guess the ID. Returns 404 for both "not found" and "not yours".
 */
import { requireAuth, json } from '../../../_lib/auth.js';

export const onRequestOptions = () =>
  new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
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
