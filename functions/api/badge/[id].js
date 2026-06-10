/**
 * GET /api/badge/:scanId — embeddable SVG health badge for a completed scan.
 * Public, same access model as the report page (anyone with the scan id).
 * Served with a 1-hour cache so embeds don't hammer the database.
 */
const GRADE_COLORS = {
  A: '#16a34a', // green-600
  B: '#65a30d', // lime-600
  C: '#d97706', // amber-600
  D: '#ea580c', // orange-600
  F: '#dc2626', // red-600
};

function badgeSvg(label, value, color) {
  // Approximate text width at 11px Verdana — values are short and predictable
  const labelW = Math.round(label.length * 6.5 + 14);
  const valueW = Math.round(value.length * 7 + 16);
  const w = labelW + valueW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}">
  <clipPath id="r"><rect width="${w}" height="20" rx="4"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="20" fill="#475569"/>
    <rect x="${labelW}" width="${valueW}" height="20" fill="${color}"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelW / 2}" y="14">${label}</text>
    <text x="${labelW + valueW / 2}" y="14" font-weight="bold">${value}</text>
  </g>
</svg>`;
}

export async function onRequestGet({ params, env }) {
  const row = await env.DB.prepare(
    `SELECT json_extract(r.rendered_summary_json, '$.healthScore') AS score,
            json_extract(r.rendered_summary_json, '$.grade') AS grade
     FROM reports r
     JOIN scans s ON s.id = r.scan_id
     WHERE r.scan_id = ? AND r.report_type = 'browser' AND s.status = 'complete'`
  ).bind(params.id).first();

  const headers = {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  };

  if (!row || row.score === null || row.score === undefined) {
    return new Response(badgeSvg('site health', 'unknown', '#94a3b8'), { status: 404, headers });
  }

  const value = `${row.grade} · ${row.score}/100`;
  return new Response(badgeSvg('site health', value, GRADE_COLORS[row.grade] || '#94a3b8'), { headers });
}
