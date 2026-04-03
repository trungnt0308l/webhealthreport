/**
 * Report generation — produces the summary JSON stored in reports table.
 * Accepts pre-loaded scan/issues/pages from finalize() to avoid re-fetching.
 */
import { computeHealthScore, scoreGrade } from './issues.js';

export async function generateReport(env, scanId, scan, issues, pageList) {
  // Fall back to DB fetch if called without pre-loaded data (e.g. from report endpoint)
  if (!scan) {
    scan = await env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(scanId).first();
  }
  if (!issues) {
    const result = await env.DB.prepare('SELECT * FROM issues WHERE scan_id = ? ORDER BY severity, issue_type').bind(scanId).all();
    issues = result.results || [];
  }
  if (!pageList) {
    const result = await env.DB.prepare('SELECT url, status_code, title, text_length, response_ms FROM pages WHERE scan_id = ?').bind(scanId).all();
    pageList = result.results || [];
  }

  const healthScore = computeHealthScore(issues);
  const grade = scoreGrade(healthScore);

  const critical = issues.filter(i => i.severity === 'critical');
  const important = issues.filter(i => i.severity === 'important');
  const minor = issues.filter(i => i.severity === 'minor');

  const summary = {
    scanId,
    url: scan.url,
    baseDomain: scan.base_domain,
    scannedAt: scan.finished_at,
    healthScore,
    grade,
    pagesChecked: scan.pages_crawled,
    linksChecked: scan.links_checked,
    totalIssues: issues.length,
    criticalCount: critical.length,
    importantCount: important.length,
    minorCount: minor.length,
    issues: issues.map(i => ({
      id: i.id,
      type: i.issue_type,
      severity: i.severity,
      title: i.title,
      explanation: i.explanation,
      recommendedAction: i.recommended_action,
      affectedCount: i.affected_count,
      example: i.example_json ? JSON.parse(i.example_json) : null,
    })),
    pages: pageList.map(p => ({
      url: p.url,
      statusCode: p.status_code,
      title: p.title,
      responseMs: p.response_ms,
    })),
  };

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO reports (scan_id, report_type, rendered_summary_json, created_at)
     VALUES (?, 'browser', ?, ?)`
  ).bind(scanId, JSON.stringify(summary), now).run();

  return summary;
}
