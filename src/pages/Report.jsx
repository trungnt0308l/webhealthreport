import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import { useAdmin } from '../lib/admin-context.jsx';
import { getScanReport, addSuppression, emailReport } from '../lib/api.js';
import { scoreColor, scoreBgColor, severityBadgeClass, gradeDescription, shortUrl, downloadCsv } from '../lib/format.js';

function decodeEntities(str) {
  if (!str || !str.includes('&')) return str;
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

function statusCodeColor(code) {
  if (!code) return 'text-slate-400';
  if (code < 300) return 'text-green-600';
  if (code < 400) return 'text-amber-500';
  return 'text-red-500';
}


function formatDetectedOn(ts) {
  if (!ts) return null;
  const diffDays = Math.floor((Date.now() - ts * 1000) / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays} days ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const ISSUE_LABELS = {
  broken_internal_link: 'Broken internal link',
  broken_external_link: 'Broken external link',
  broken_image: 'Broken image',
  redirect_chain: 'Redirect chain',
  missing_title: 'Missing page title',
  thin_page: 'Thin page',
  slow_page: 'Slow page load',
  homepage_unavailable: 'Homepage unavailable',
};

function FoundOnCell({ sourceUrl, title }) {
  if (!sourceUrl) return <span className="text-slate-300">—</span>;
  const display = title ? decodeEntities(title) : shortUrl(sourceUrl, 60);
  return (
    <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
       className="text-brand-600 hover:underline text-xs truncate block max-w-xs leading-snug" title={sourceUrl}>
      {display}
    </a>
  );
}

function PagesTable({ pages, report }) {
  const [open, setOpen] = useState(false);

  function exportPagesCsv() {
    const headers = ['URL', 'HTTP Status', 'Title', 'Response Time (ms)'];
    const rows = pages.map(p => [p.url, p.statusCode ?? '', p.title ?? '', p.responseMs ?? '']);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`${report.baseDomain}-pages-${date}.csv`, headers, rows);
  }

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 text-left"
        >
          <h3 className="font-semibold text-slate-800">
            Pages crawled <span className="text-slate-400 font-normal">({pages.length})</span>
          </h3>
          <span className="text-slate-400 text-sm">{open ? '▲' : '▼'}</span>
        </button>
        <button
          onClick={exportPagesCsv}
          className="text-xs text-slate-500 hover:text-brand-600 border border-slate-200 rounded px-3 py-1.5 transition-colors"
        >
          Export CSV ↓
        </button>
      </div>
      {open && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2 text-slate-500 font-medium w-12">Status</th>
                <th className="text-left px-4 py-2 text-slate-500 font-medium">URL</th>
                <th className="text-left px-4 py-2 text-slate-500 font-medium hidden sm:table-cell">Title</th>
                <th className="text-right px-4 py-2 text-slate-500 font-medium w-16 hidden sm:table-cell">ms</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className={`px-4 py-2 font-mono font-bold ${statusCodeColor(p.statusCode)}`}>{p.statusCode ?? '?'}</td>
                  <td className="px-4 py-2 font-mono text-slate-600 truncate max-w-xs" title={p.url}>{shortUrl(p.url)}</td>
                  <td className="px-4 py-2 text-slate-500 hidden sm:table-cell truncate max-w-xs">{p.title ? decodeEntities(p.title) : '—'}</td>
                  <td className="px-4 py-2 text-slate-400 text-right hidden sm:table-cell">{p.responseMs || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CopyCell({ urlKey, url, maxLen = 60, copiedId, onCopy }) {
  const isCopied = copiedId === urlKey;
  if (!url) return <span className="text-slate-300">—</span>;
  return (
    <button onClick={() => onCopy(urlKey, url)} title={url} className="text-left w-full group">
      <span className={`block font-mono text-xs truncate leading-snug ${isCopied ? 'text-green-600' : 'text-slate-600 group-hover:text-brand-600'}`}>
        {isCopied ? '✓ Copied!' : shortUrl(url, maxLen)}
      </span>
    </button>
  );
}

function IssueTable({ issues: initialIssues, pages, siteId, token, report }) {
  const [issues, setIssues] = useState(initialIssues);
  const [copiedId, setCopiedId] = useState(null);
  const [suppressingId, setSuppressingId] = useState(null);
  const [suppressError, setSuppressError] = useState(null);

  const pageTitle = {};
  for (const p of pages || []) if (p.url) pageTitle[p.url] = p.title;

  function copyUrl(key, url) {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(key);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }

  async function handleSuppress(issue) {
    setSuppressingId(issue.id);
    setSuppressError(null);
    setIssues(prev => prev.filter(i => i.id !== issue.id)); // optimistic hide
    try {
      await addSuppression(token, siteId, issue.type, issue.targetUrl || '');
    } catch {
      setIssues(initialIssues); // restore on error
      setSuppressError('Could not hide this issue. Please try again.');
    } finally {
      setSuppressingId(null);
    }
  }

  function exportIssuesCsv() {
    const headers = [
      'Severity', 'Issue Type', 'Affected URL', 'Anchor Text',
      'Found On (1)', 'Found On (2)', 'Found On (3)',
      'HTTP Status', 'Recommended Action', 'Explanation', 'First Detected',
    ];
    const rows = issues.map(issue => {
      const src = issue.example?.sources ?? [];
      return [
        issue.severity,
        ISSUE_LABELS[issue.type] || issue.type,
        issue.example?.target || issue.example?.url || '',
        issue.example?.anchorText || '',
        src[0] || '', src[1] || '', src[2] || '',
        issue.example?.status || '',
        issue.recommendedAction || '',
        issue.explanation || '',
        issue.firstDetectedAt ? new Date(issue.firstDetectedAt * 1000).toLocaleDateString() : '',
      ];
    });
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`${report.baseDomain}-issues-${date}.csv`, headers, rows);
  }

  const showSuppressCol = siteId !== undefined; // show column for any monitored-site report
  const canSuppress = siteId && token;

  const groups = [
    { label: 'Critical', items: issues.filter(i => i.severity === 'critical') },
    { label: 'Important', items: issues.filter(i => i.severity === 'important') },
    { label: 'Minor', items: issues.filter(i => i.severity === 'minor') },
  ].filter(g => g.items.length > 0);

  const colSpan = showSuppressCol ? 4 : 3;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-slate-800">Issues found</h2>
        <button
          onClick={exportIssuesCsv}
          className="text-xs text-slate-500 hover:text-brand-600 border border-slate-200 rounded px-3 py-1.5 transition-colors"
        >
          Export CSV ↓
        </button>
      </div>
      {suppressError && (
        <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          {suppressError}
        </div>
      )}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-slate-500 font-medium w-40">Severity</th>
              <th className="text-left px-4 py-2.5 text-slate-500 font-medium w-1/2">Broken URL</th>
              <th className="text-left px-4 py-2.5 text-slate-500 font-medium">Found on</th>
              {showSuppressCol && <th className="w-28" />}
            </tr>
          </thead>
          <tbody>
            {groups.map(({ label, items }) => (
              <>
                <tr key={label} className="bg-slate-50 border-y border-slate-200">
                  <td colSpan={colSpan} className="px-4 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {label} ({items.length})
                  </td>
                </tr>
                {items.map((issue, idx) => {
                  const brokenUrl = issue.example?.target || issue.example?.url || null;
                  const sourceUrl = Array.isArray(issue.example?.sources)
                    ? (issue.example.sources[0] || null)
                    : (issue.example?.url || null);
                  const tgtKey = `${label}-${idx}-tgt`;
                  const detectedOn = formatDetectedOn(issue.firstDetectedAt);
                  return (
                    <tr key={`${label}-${idx}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 align-middle">
                      <td className="px-4 py-3">
                        <span className={severityBadgeClass(issue.severity)}>{issue.severity}</span>
                        <div className="text-xs text-slate-500 mt-1 leading-snug">{ISSUE_LABELS[issue.type] || issue.type}</div>
                        {detectedOn && (
                          <div className="text-xs text-slate-400 mt-0.5">Since {detectedOn}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-0">
                        {issue.example?.anchorText && (
                          <div className="text-xs text-slate-400 mb-0.5 truncate" title={decodeEntities(issue.example.anchorText)}>
                            "{decodeEntities(issue.example.anchorText)}"
                          </div>
                        )}
                        <CopyCell urlKey={tgtKey} url={brokenUrl} maxLen={100} copiedId={copiedId} onCopy={copyUrl} />
                      </td>
                      <td className="px-4 py-3 max-w-0">
                        <FoundOnCell sourceUrl={sourceUrl} title={pageTitle[sourceUrl]} />
                      </td>
                      {showSuppressCol && (
                        <td className="px-4 py-3 text-right">
                          {canSuppress ? (
                            <button
                              onClick={() => handleSuppress(issue)}
                              disabled={suppressingId === issue.id}
                              className="text-xs text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40"
                              title="Mark as false positive — hide from future reports"
                            >
                              {suppressingId === issue.id ? 'Hiding…' : 'Not an issue'}
                            </button>
                          ) : (
                            <button
                              disabled
                              className="text-xs text-slate-300 cursor-default"
                              title="Sign in to suppress false positives"
                            >
                              Not an issue
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FixedIssuesSection({ fixedIssues }) {
  if (!fixedIssues?.length) return null;
  return (
    <div className="mb-8">
      <h2 className="text-lg font-bold text-slate-800 mb-4">
        Fixed since last scan
        <span className="ml-2 text-green-600 text-base font-normal">({fixedIssues.length} resolved)</span>
      </h2>
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-green-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-slate-500 font-medium w-40">Severity</th>
              <th className="text-left px-4 py-2.5 text-slate-500 font-medium">Issue</th>
            </tr>
          </thead>
          <tbody>
            {fixedIssues.map((issue, i) => (
              <tr key={i} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">
                  <span className={severityBadgeClass(issue.severity)}>{issue.severity}</span>
                  <div className="text-xs text-slate-500 mt-1 leading-snug">{ISSUE_LABELS[issue.type] || issue.type}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-slate-400 line-through text-xs font-mono truncate max-w-sm">
                    {shortUrl(issue.targetUrl, 80)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmailReportForm({ scanId, prefillEmail }) {
  const [email, setEmail] = useState(prefillEmail || '');
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus('sending');
    setErrorMsg('');
    try {
      await emailReport(scanId, email);
      setStatus('sent');
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  }

  if (status === 'sent') {
    return (
      <div className="card bg-green-50 border-green-200 mb-8 flex items-center gap-3">
        <span className="text-green-600 text-lg">✓</span>
        <p className="text-sm text-green-800">
          Report sent to <strong>{email}</strong>. Check your inbox.
        </p>
      </div>
    );
  }

  return (
    <div className="card mb-8">
      <p className="text-sm font-medium text-slate-700 mb-3">Email this report to yourself</p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
          disabled={status === 'sending'}
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
        />
        <button
          type="submit"
          disabled={status === 'sending' || !email}
          className="btn-primary text-sm whitespace-nowrap"
        >
          {status === 'sending' ? 'Sending…' : 'Send report →'}
        </button>
      </form>
      {status === 'error' && (
        <p className="text-xs text-red-600 mt-2">{errorMsg}</p>
      )}
    </div>
  );
}

function WeeklyMonitoringCta() {
  const { isAuthenticated, loginWithRedirect } = useAuth0();
  const navigate = useNavigate();

  function handleClick() {
    if (isAuthenticated) {
      navigate('/account');
    } else {
      loginWithRedirect({ appState: { returnTo: '/account' } });
    }
  }

  return (
    <div className="card bg-brand-700 text-white border-brand-700">
      <h2 className="text-xl font-bold mb-2">Get this report automatically every week</h2>
      <p className="text-brand-100 text-sm mb-4">
        Know about new issues before your customers do. The same scan, delivered to your inbox every week.
      </p>
      <button
        className="bg-white text-brand-700 font-semibold px-5 py-2.5 rounded-lg hover:bg-brand-50 transition-colors text-sm"
        onClick={handleClick}
      >
        Start weekly monitoring →
      </button>
    </div>
  );
}

export default function Report() {
  const { id } = useParams();
  const { isAuthenticated, isLoading, getAccessTokenSilently, loginWithRedirect, user } = useAuth0();
  const [adminKey] = useAdmin();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [token, setToken] = useState(null);

  useEffect(() => {
    if (isLoading) return;
    let active = true;
    setReport(null);
    setError('');
    (async () => {
      const bearer = adminKey || (isAuthenticated ? await getAccessTokenSilently() : null);
      if (active) setToken(bearer);
      return getScanReport(id, bearer);
    })()
      .then(data => {
        if (!active) return;
        if (data) setReport(data);
        else setError('Report not ready yet.');
      })
      .catch(() => { if (active) setError('Report unavailable. Sign in to the owning account, or open it from the admin dashboard.'); });
    return () => { active = false; };
  }, [id, isLoading, isAuthenticated, getAccessTokenSilently, adminKey]);

  useEffect(() => {
    if (report?.baseDomain) {
      document.title = `Health Report: ${report.baseDomain} — Website Health Report`;
      return () => { document.title = 'Website Health Report — Free Website Scanner'; };
    }
  }, [report?.baseDomain]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card text-center max-w-sm">
          <p className="text-slate-600 mb-4">{error}</p>
          {!isAuthenticated && <button className="btn-primary mb-4" onClick={() => loginWithRedirect({ appState: { returnTo: `/report/${id}` } })}>Sign in</button>}
          <Link to="/monitor" className="block text-brand-600 text-sm mb-4">Open admin dashboard</Link>
          <Link to="/" className="text-brand-600 text-sm hover:underline">← Start a new scan</Link>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-400">Loading report…</div>
      </div>
    );
  }

  const scanDate = report.scannedAt
    ? new Date(report.scannedAt * 1000).toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center text-white font-bold text-sm">W</div>
            <span className="font-semibold text-slate-800">Website Health Report</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link to="/faq" className="text-slate-500 hover:text-slate-800 transition-colors hidden sm:inline">FAQ</Link>
            <Link to="/" className="text-brand-600 hover:underline">← New scan</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {/* Report header */}
        <div className="mb-2 text-sm text-slate-400">{scanDate}</div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1 break-all">{report.baseDomain}</h1>
        <p className="text-slate-500 text-sm mb-8">{report.url}</p>

        {/* Health score */}
        <div className={`card border-2 ${scoreBgColor(report.healthScore)} mb-8 flex items-center gap-6`}>
          <div className={`text-6xl font-black leading-none ${scoreColor(report.healthScore)}`}>
            {report.healthScore}
          </div>
          <div>
            <div className={`text-2xl font-bold ${scoreColor(report.healthScore)}`}>
              Grade {report.grade} — {gradeDescription(report.grade)}
            </div>
            <div className="text-slate-500 text-sm mt-1">
              Scanned {report.pagesChecked} page{report.pagesChecked !== 1 ? 's' : ''} · {report.linksChecked} links · {report.totalIssues} issue{report.totalIssues !== 1 ? 's' : ''} found
              {report.suppressedCount > 0 && (
                <span className="text-slate-400"> · {report.suppressedCount} hidden</span>
              )}
            </div>
          </div>
        </div>

        {/* Email capture */}
        {report.canEmail && <EmailReportForm scanId={id} prefillEmail={user?.email} />}

        {/* Weekly monitoring CTA — top */}
        {!isAuthenticated && (
          <div className="mb-8">
            <WeeklyMonitoringCta />
          </div>
        )}

        {/* Summary counts */}
        {report.totalIssues > 0 ? (
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="card text-center border-red-100">
              <div className="text-3xl font-bold text-red-600">{report.criticalCount}</div>
              <div className="text-xs text-slate-500 mt-1 uppercase tracking-wide font-medium">Critical</div>
            </div>
            <div className="card text-center border-amber-100">
              <div className="text-3xl font-bold text-amber-500">{report.importantCount}</div>
              <div className="text-xs text-slate-500 mt-1 uppercase tracking-wide font-medium">Important</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-slate-500">{report.minorCount}</div>
              <div className="text-xs text-slate-500 mt-1 uppercase tracking-wide font-medium">Minor</div>
            </div>
          </div>
        ) : (
          <div className="card bg-green-50 border-green-200 text-center mb-8">
            <div className="text-3xl mb-2">✅</div>
            <div className="font-semibold text-green-800">No issues found</div>
            <div className="text-sm text-green-700 mt-1">Your site looks healthy across {report.pagesChecked} pages scanned.</div>
          </div>
        )}

        {/* Issues table */}
        {report.totalIssues > 0 && (
          <IssueTable
            issues={report.issues}
            pages={report.pages}
            siteId={report.siteId}
            token={adminKey ? null : token}
            report={report}
          />
        )}

        {/* Fixed since last scan */}
        <FixedIssuesSection fixedIssues={report.fixedIssues} />

        {/* Pages crawled */}
        {report.pages && report.pages.length > 0 && (
          <PagesTable pages={report.pages} report={report} />
        )}

        {/* Weekly monitoring CTA — bottom */}
        {!isAuthenticated && <WeeklyMonitoringCta />}
      </main>
    </div>
  );
}
