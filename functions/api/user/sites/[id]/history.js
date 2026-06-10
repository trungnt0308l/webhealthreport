/**
 * GET /api/user/sites/:id/history — health score history for a monitored site.
 * Returns the most recent 26 completed scans (about 6 months of weekly scans),
 * oldest first, with score, grade and issue count pulled from the cached report.
 * The WHERE user_id = ? clause prevents IDOR — users can only read their own sites.
 */
import { requireAuth, json } from '../../../../_lib/auth.js';
import { corsOptions } from '../../../../_lib/response.js';

export const onRequestOptions = ({ request, env }) => corsOptions(request, env, 'GET, OPTIONS');

export const onRequestGet = requireAuth(async ({ params, env, data }) => {
  const site = await env.DB.prepare(
    `SELECT id FROM monitored_sites WHERE id = ? AND user_id = ?`
  ).bind(params.id, data.user.id).first();
  if (!site) return json({ error: 'Site not found' }, 404);

  const { results } = await env.DB.prepare(
    `SELECT s.id, s.finished_at,
            CAST(json_extract(r.rendered_summary_json, '$.healthScore') AS INTEGER) AS health_score,
            json_extract(r.rendered_summary_json, '$.grade') AS grade,
            CAST(json_extract(r.rendered_summary_json, '$.totalIssues') AS INTEGER) AS total_issues
     FROM scans s
     JOIN reports r ON r.scan_id = s.id AND r.report_type = 'browser'
     WHERE s.site_id = ? AND s.status = 'complete'
     ORDER BY s.finished_at DESC
     LIMIT 26`
  ).bind(params.id).all();

  const scans = (results || [])
    .filter(r => r.health_score !== null)
    .reverse()
    .map(r => ({
      scanId: r.id,
      finishedAt: r.finished_at,
      healthScore: r.health_score,
      grade: r.grade,
      totalIssues: r.total_issues,
    }));

  return json({ scans });
});
