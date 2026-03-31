/**
 * GET /api/scans/:id/report
 * Returns the stored report JSON for a completed scan.
 */

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', '*');
  return r;
}

export async function onRequestGet({ params, env }) {
  const { id: scanId } = params;

  const report = await env.DB.prepare(
    `SELECT * FROM reports WHERE scan_id = ? AND report_type = 'browser'`
  ).bind(scanId).first();

  if (!report) {
    // Check if scan exists at all
    const scan = await env.DB.prepare('SELECT status FROM scans WHERE id = ?').bind(scanId).first();
    if (!scan) {
      return cors(new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      }));
    }
    return cors(new Response(JSON.stringify({ error: 'Report not ready', status: scan.status }), {
      status: 202, headers: { 'Content-Type': 'application/json' },
    }));
  }

  return cors(new Response(report.rendered_summary_json, {
    headers: { 'Content-Type': 'application/json' },
  }));
}
