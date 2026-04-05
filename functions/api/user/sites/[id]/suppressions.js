/**
 * POST   /api/user/sites/:id/suppressions  — mark an issue as "not an issue" for this site
 * DELETE /api/user/sites/:id/suppressions  — un-suppress a previously suppressed issue
 *
 * Body: { issueType: string, targetUrl: string }
 * The WHERE user_id = ? clause prevents IDOR — users cannot suppress issues on other sites.
 */
import { requireAuth, json } from '../../../../_lib/auth.js';
import { getAllowedOrigin } from '../../../../_lib/cors.js';

export const onRequestOptions = ({ request, env }) =>
  new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });

async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export const onRequestPost = requireAuth(async ({ request, params, env, data }) => {
  const siteId = params.id;
  const body = await parseBody(request);
  if (!body?.issueType) return json({ error: 'issueType is required' }, 400);

  // Verify ownership
  const site = await env.DB.prepare(
    `SELECT id FROM monitored_sites WHERE id = ? AND user_id = ?`
  ).bind(siteId, data.user.id).first();
  if (!site) return json({ error: 'Site not found' }, 404);

  const safeTarget = body.targetUrl || '';
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO suppressed_issues (site_id, issue_type, target_url, suppressed_at, suppressed_by)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(siteId, body.issueType, safeTarget, now, data.user.id).run();

  return json({ ok: true });
});

export const onRequestDelete = requireAuth(async ({ request, params, env, data }) => {
  const siteId = params.id;
  const body = await parseBody(request);
  if (!body?.issueType) return json({ error: 'issueType is required' }, 400);

  // Verify ownership
  const site = await env.DB.prepare(
    `SELECT id FROM monitored_sites WHERE id = ? AND user_id = ?`
  ).bind(siteId, data.user.id).first();
  if (!site) return json({ error: 'Site not found' }, 404);

  const safeTarget = body.targetUrl || '';

  await env.DB.prepare(
    `DELETE FROM suppressed_issues WHERE site_id = ? AND issue_type = ? AND target_url = ?`
  ).bind(siteId, body.issueType, safeTarget).run();

  return json({ ok: true });
});
