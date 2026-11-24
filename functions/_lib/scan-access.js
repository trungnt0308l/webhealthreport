import { verifyAuth0JWT } from './auth.js';
import { adminAuthCheck } from './monitor-auth.js';

export async function accessibleScan(request, env, id) {
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  let owner = null;
  const admin = !!token && adminAuthCheck(new Request(request.url, { headers: { Authorization: `Bearer ${token}` } }), env, () => true) === null;
  if (token && !admin) {
    try { owner = (await verifyAuth0JWT(token, env)).sub; } catch { /* Public scans remain shareable. */ }
  }
  // Apply access in SQL, before materializing a private record or touching scan data.
  return env.DB.prepare(`SELECT * FROM scans WHERE id = ? AND
    (access_scope = 'public' OR access_owner_id = ? OR ? = 1)`)
    .bind(id, owner, admin ? 1 : 0).first();
}
