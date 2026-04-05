/**
 * POST   /api/monitored-sites/:id/suppressions — add suppression (admin)
 * DELETE /api/monitored-sites/:id/suppressions — remove suppression (admin)
 *
 * Body: { issueType: string, targetUrl: string }
 * Admin-only suppression management for sites not owned by a specific user.
 */
import { adminAuthCheck } from '../../../_lib/monitor-auth.js';
import { getAllowedOrigin } from '../../../_lib/cors.js';

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function onRequestOptions({ request, env }) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': getAllowedOrigin(request, env),
      'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function onRequestPost({ request, params, env }) {
  const denied = adminAuthCheck(request, env, (d, s) => json(request, env, d, s));
  if (denied) return denied;

  const siteId = params.id;
  const body = await parseBody(request);
  if (!body?.issueType) return json(request, env, { error: 'issueType is required' }, 400);

  const site = await env.DB.prepare(
    `SELECT id FROM monitored_sites WHERE id = ?`
  ).bind(siteId).first();
  if (!site) return json(request, env, { error: 'Site not found' }, 404);

  const safeTarget = body.targetUrl || '';
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO suppressed_issues (site_id, issue_type, target_url, suppressed_at, suppressed_by)
     VALUES (?, ?, ?, ?, 'admin')`
  ).bind(siteId, body.issueType, safeTarget, now).run();

  return json(request, env, { ok: true });
}

export async function onRequestDelete({ request, params, env }) {
  const denied = adminAuthCheck(request, env, (d, s) => json(request, env, d, s));
  if (denied) return denied;

  const siteId = params.id;
  const body = await parseBody(request);
  if (!body?.issueType) return json(request, env, { error: 'issueType is required' }, 400);

  const safeTarget = body.targetUrl || '';

  await env.DB.prepare(
    `DELETE FROM suppressed_issues WHERE site_id = ? AND issue_type = ? AND target_url = ?`
  ).bind(siteId, body.issueType, safeTarget).run();

  return json(request, env, { ok: true });
}
