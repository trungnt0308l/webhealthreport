/**
 * Report generation — produces the summary JSON stored in reports table.
 */
import { computeHealthScore, scoreGrade } from './issues.js';

export async function generateReport(env, scanId) {
  const scan = await env.DB.prepare('SELECT * FROM scans WHERE id = ?').bind(scanId).first();
  const issues = await env.DB.prepare('SELECT * FROM issues WHERE scan_id = ? ORDER BY severity, issue_type').bind(scanId).all();
  const pages = await env.DB.prepare('SELECT * FROM pages WHERE scan_id = ?').bind(scanId).all();

  const issueList = issues.results || [];
  const pageList = pages.results || [];

  const healthScore = computeHealthScore(issueList);
  const grade = scoreGrade(healthScore);

  const critical = issueList.filter(i => i.severity === 'critical');
  const important = issueList.filter(i => i.severity === 'important');
  const minor = issueList.filter(i => i.severity === 'minor');

  const summary = {
    scanId,
    url: scan.url,
    baseDomain: scan.base_domain,
    scannedAt: scan.finished_at,
    healthScore,
    grade,
    pagesChecked: scan.pages_crawled,
    linksChecked: scan.links_checked,
    totalIssues: issueList.length,
    criticalCount: critical.length,
    importantCount: important.length,
    minorCount: minor.length,
    issues: issueList.map(i => ({
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
