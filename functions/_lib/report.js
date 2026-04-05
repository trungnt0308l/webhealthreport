/**
 * Report generation — produces the summary JSON stored in reports table.
 * Accepts pre-loaded scan/issues/pages from finalize() to avoid re-fetching.
 *
 * Architecture: the reports table caches a scan-stable base snapshot.
 * When siteId is present, three lightweight parallel queries overlay live context
 * (suppressions, first-detected history, fixed-since-last-run diff) on top.
 * This ensures suppressions take effect immediately without cache invalidation.
 */
import { computeHealthScore, scoreGrade } from './issues.js';

export async function generateReport(env, scanId, scan, issues, pageList, siteId = null) {
  // Fall back to DB fetch if called without pre-loaded data (e.g. from report endpoint)
  if (!scan) {
    scan = await env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(scanId).first();
  }
  if (!issues) {
    const result = await env.DB.prepare(
      'SELECT * FROM issues WHERE scan_id = ? ORDER BY severity, issue_type'
    ).bind(scanId).all();
    issues = result.results || [];
  }
  if (!pageList) {
    const result = await env.DB.prepare(
      'SELECT url, status_code, title, text_length, response_ms FROM pages WHERE scan_id = ?'
    ).bind(scanId).all();
    pageList = result.results || [];
  }

  // Build base (scan-stable) snapshot — used for caching
  const baseScore = computeHealthScore(issues);
  const baseGrade = scoreGrade(baseScore);

  const baseSummary = {
    scanId,
    url: scan.url,
    baseDomain: scan.base_domain,
    scannedAt: scan.finished_at,
    healthScore: baseScore,
    grade: baseGrade,
    pagesChecked: scan.pages_crawled,
    linksChecked: scan.links_checked,
    totalIssues: issues.length,
    criticalCount: issues.filter(i => i.severity === 'critical').length,
    importantCount: issues.filter(i => i.severity === 'important').length,
    minorCount: issues.filter(i => i.severity === 'minor').length,
    issues: issues.map(i => ({
      id: i.id,
      type: i.issue_type,
      severity: i.severity,
      title: i.title,
      explanation: i.explanation,
      recommendedAction: i.recommended_action,
      affectedCount: i.affected_count,
      targetUrl: i.target_url || null,
      firstDetectedAt: scan.finished_at,
      example: i.example_json ? JSON.parse(i.example_json) : null,
    })),
    pages: pageList.map(p => ({
      url: p.url,
      statusCode: p.status_code,
      title: p.title,
      responseMs: p.response_ms,
    })),
  };

  // Cache the base snapshot
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO reports (scan_id, report_type, rendered_summary_json, created_at)
     VALUES (?, 'browser', ?, ?)`
  ).bind(scanId, JSON.stringify(baseSummary), now).run();

  // If no siteId, return the base snapshot as-is
  if (!siteId) return baseSummary;

  // Overlay live context: suppressions, history, fixed diff — all in parallel
  const [suppressedRows, historyRows, prevIssues] = await Promise.all([
    env.DB.prepare(
      `SELECT issue_type, target_url FROM suppressed_issues WHERE site_id = ?`
    ).bind(siteId).all().then(r => r.results || []),

    env.DB.prepare(
      `SELECT issue_type, target_url, first_detected_at FROM issue_history WHERE site_id = ?`
    ).bind(siteId).all().then(r => r.results || []),

    env.DB.prepare(
      `SELECT issue_type, target_url, severity, title
       FROM issues
       WHERE scan_id = (
         SELECT id FROM scans
         WHERE site_id = ? AND status = 'complete' AND id != ?
         ORDER BY finished_at DESC LIMIT 1
       ) AND target_url IS NOT NULL AND target_url != ''`
    ).bind(siteId, scanId).all().then(r => r.results || []),
  ]);

  const suppressedSet = new Set(suppressedRows.map(r => r.issue_type + ':' + r.target_url));
  const historyMap = new Map(historyRows.map(r => [r.issue_type + ':' + r.target_url, r.first_detected_at]));

  // Build the current scan's fingerprint set (raw, before filtering) for "fixed" diff
  const currentFpSet = new Set(baseSummary.issues.map(i => i.type + ':' + (i.targetUrl || '')));

  // Filter out suppressed issues
  const activeIssues = baseSummary.issues.filter(i =>
    !suppressedSet.has(i.type + ':' + (i.targetUrl || ''))
  );

  // Recompute score using only active (non-suppressed) issues
  const healthScore = computeHealthScore(activeIssues.map(i => ({ severity: i.severity })));
  const grade = scoreGrade(healthScore);

  // Enrich with firstDetectedAt from history
  const enrichedIssues = activeIssues.map(i => ({
    ...i,
    firstDetectedAt: historyMap.get(i.type + ':' + (i.targetUrl || '')) || scan.finished_at,
  }));

  // Issues from the previous scan that are no longer present = fixed
  const fixedIssues = prevIssues
    .filter(i => !currentFpSet.has(i.issue_type + ':' + i.target_url))
    .map(i => ({
      type: i.issue_type,
      severity: i.severity,
      title: i.title,
      targetUrl: i.target_url,
    }));

  return {
    ...baseSummary,
    siteId,
    healthScore,
    grade,
    totalIssues: activeIssues.length,
    criticalCount: activeIssues.filter(i => i.severity === 'critical').length,
    importantCount: activeIssues.filter(i => i.severity === 'important').length,
    minorCount: activeIssues.filter(i => i.severity === 'minor').length,
    suppressedCount: baseSummary.issues.length - activeIssues.length,
    issues: enrichedIssues,
    fixedIssues,
  };
}
