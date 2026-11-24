/**
 * GET  /api/user/sites — list the authenticated user's monitored sites
 * POST /api/user/sites — add a new monitored site for the authenticated user
 *   Body: { url: string, emails?: string[] }
 */
import { requireAuth, json } from '../../../_lib/auth.js';
import { corsOptions } from '../../../_lib/response.js';


export const onRequestOptions = ({ request, env }) => corsOptions(request, env, 'GET, OPTIONS');

export const onRequestGet = requireAuth(async ({ env, data }) => {
  const result = await env.DB.prepare(
    `SELECT ms.id, ms.url, ms.base_domain, ms.emails, ms.last_scan_id, ms.pending_scan_id,
            ms.next_scan_at, ms.created_at, ms.last_scan_status, ms.last_scan_error, ms.paused,
            s.finished_at AS last_scan_at
     FROM monitored_sites ms
     LEFT JOIN scans s ON s.id = ms.last_scan_id
     WHERE ms.user_id = ?
     ORDER BY ms.created_at DESC`
  ).bind(data.user.id).all();

  return json({ sites: result.results || [] });
});
