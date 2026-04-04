/**
 * Weekly health report email via Resend API.
 * Throws on non-2xx so the caller can log without blocking schedule advancement.
 */

export async function sendReportEmail(env, site, report) {
  const emails = JSON.parse(site.emails);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: emails,
      subject: `[${report.grade}] ${report.baseDomain} — weekly health report`,
      html: buildEmailHtml(report),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

function buildEmailHtml(report) {
  const date = report.scannedAt
    ? new Date(report.scannedAt * 1000).toLocaleString('en-US', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '';

  const gradeColor = {
    A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#ea580c', F: '#dc2626',
  }[report.grade] || '#64748b';

  const severityColor = { critical: '#dc2626', important: '#d97706', minor: '#64748b' };
  const severityLabel  = { critical: 'Critical', important: 'Important', minor: 'Minor' };

  const issueRows = (report.issues || []).slice(0, 10).map(issue => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
        <span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;color:#fff;background:${severityColor[issue.severity] || '#64748b'};">
          ${severityLabel[issue.severity] || issue.severity}
        </span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#1e293b;">
        ${htmlEsc(issue.title)}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;text-align:right;">
        ${issue.affectedCount > 1 ? issue.affectedCount + ' affected' : ''}
      </td>
    </tr>`).join('');

  const reportUrl = `https://webhealthreport.pages.dev/report/${report.scanId}`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:#1e40af;padding:20px 28px;">
            <span style="font-size:18px;font-weight:700;color:#fff;">Website Health Report</span>
            <span style="display:block;font-size:13px;color:#93c5fd;margin-top:2px;">
              <a href="https://${htmlEsc(report.baseDomain)}" style="color:#93c5fd;text-decoration:none;">${htmlEsc(report.baseDomain)}</a> &nbsp;·&nbsp; ${date}
            </span>
          </td>
        </tr>

        <!-- Score row -->
        <tr>
          <td style="padding:24px 28px;border-bottom:1px solid #e2e8f0;">
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td width="80" style="vertical-align:middle;">
                  <div style="width:72px;height:72px;border-radius:50%;border:4px solid ${gradeColor};text-align:center;line-height:72px;">
                    <span style="font-size:28px;font-weight:800;color:${gradeColor};line-height:72px;">${report.healthScore}</span>
                  </div>
                </td>
                <td style="padding-left:20px;vertical-align:middle;">
                  <div style="font-size:20px;font-weight:700;color:${gradeColor};">Grade ${report.grade}</div>
                  <div style="font-size:13px;color:#64748b;margin-top:4px;">
                    ${report.pagesChecked} pages &nbsp;·&nbsp; ${report.linksChecked} links checked
                  </div>
                  <div style="font-size:13px;color:#64748b;margin-top:2px;">
                    ${report.criticalCount > 0 ? `<span style="color:#dc2626;">${report.criticalCount} critical</span> &nbsp;·&nbsp; ` : ''}
                    ${report.importantCount > 0 ? `<span style="color:#d97706;">${report.importantCount} important</span> &nbsp;·&nbsp; ` : ''}
                    ${report.minorCount} minor
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Issues table -->
        ${issueRows ? `
        <tr>
          <td style="padding:20px 28px 0;">
            <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
              Top Issues${(report.issues || []).length > 10 ? ' (showing 10 of ' + report.issues.length + ')' : ''}
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
              ${issueRows}
            </table>
          </td>
        </tr>` : `
        <tr>
          <td style="padding:20px 28px;text-align:center;color:#16a34a;font-weight:600;">
            No issues found — your site looks great!
          </td>
        </tr>`}

        <!-- CTA -->
        <tr>
          <td style="padding:24px 28px;text-align:center;border-top:1px solid #e2e8f0;margin-top:20px;">
            <a href="${reportUrl}" style="display:inline-block;background:#1e40af;color:#fff;font-weight:600;font-size:14px;padding:12px 28px;border-radius:6px;text-decoration:none;">
              View Full Report →
            </a>
            <div style="font-size:11px;color:#94a3b8;margin-top:10px;">${reportUrl}</div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:16px 28px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;">
            Weekly report from Website Health Report &nbsp;·&nbsp; Next scan in ~7 days
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function htmlEsc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
