/**
 * DELETE /api/monitored-sites/:id?key=<MONITOR_SECRET> — remove a monitored site
 */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function onRequestDelete({ params, request, env }) {
  const auth = request.headers.get('Authorization') || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!key || !env.MONITOR_SECRET || key !== env.MONITOR_SECRET) {
    return json({ error: 'Access denied' }, 403);
  }

  const { id } = params;
  const result = await env.DB.prepare(
    'DELETE FROM monitored_sites WHERE id = ?'
  ).bind(id).run();

  if (result.meta.changes === 0) {
    return json({ error: 'Site not found' }, 404);
  }

  return json({ ok: true });
}
