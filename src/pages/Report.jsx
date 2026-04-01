import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getScanReport } from '../lib/api.js';
import { scoreColor, scoreBgColor, severityBadgeClass, severityBorderClass, gradeDescription, shortenUrl } from '../lib/format.js';

function statusCodeColor(code) {
  if (!code) return 'text-slate-400';
  if (code < 300) return 'text-green-600';
  if (code < 400) return 'text-amber-500';
  return 'text-red-500';
}

function PagesTable({ pages }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-8">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-between w-full text-left mb-3"
      >
        <h3 className="font-semibold text-slate-800">
          Pages crawled <span className="text-slate-400 font-normal">({pages.length})</span>
        </h3>
        <span className="text-slate-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>
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
                  <td className="px-4 py-2 font-mono text-slate-600 max-w-xs truncate" title={p.url}>{shortenUrl(p.url)}</td>
                  <td className="px-4 py-2 text-slate-500 hidden sm:table-cell truncate max-w-xs">{p.title || '—'}</td>
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

function IssueCard({ issue }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border-l-4 ${severityBorderClass(issue.severity)} bg-white rounded-r-lg border border-l-4 border-slate-200 p-4 mb-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={severityBadgeClass(issue.severity)}>{issue.severity}</span>
            {issue.affectedCount > 1 && (
              <span className="text-xs text-slate-400">{issue.affectedCount} affected</span>
            )}
          </div>
          <div className="font-medium text-slate-800 text-sm">{issue.title}</div>
          {open && (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-slate-600">{issue.explanation}</p>
              <div className="bg-brand-50 rounded-lg p-3">
                <span className="text-xs font-semibold text-brand-700 uppercase tracking-wide">What to do</span>
                <p className="text-sm text-slate-700 mt-1">{issue.recommendedAction}</p>
              </div>
              {issue.example && (issue.example.target || issue.example.url) && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-slate-500">URL</div>
                  <div className="bg-slate-50 rounded px-3 py-2 text-xs font-mono text-slate-700 truncate select-all" title={issue.example.target || issue.example.url}>
                    {shortenUrl(issue.example.target || issue.example.url, 80)}
                  </div>
                  {issue.example.anchorText && (
                    <div className="text-xs text-slate-400">
                      {issue.type === 'broken_image' ? 'Alt text: ' : 'Link text: '}
                      <span className="text-slate-600 font-medium">"{issue.example.anchorText}"</span>
                    </div>
                  )}
                </div>
              )}
              {issue.example && issue.example.sources && issue.example.sources.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-slate-500">Found on</div>
                  {issue.example.sources.map((src, i) => (
                    <div key={i} className="bg-slate-50 rounded px-3 py-2 text-xs font-mono text-slate-500 truncate select-all" title={src}>
                      {shortenUrl(src, 80)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => setOpen(v => !v)}
          className="text-slate-400 hover:text-slate-600 text-xs shrink-0 mt-0.5"
        >
          {open ? 'Less ▲' : 'Details ▼'}
        </button>
      </div>
    </div>
  );
}

function IssueSection({ title, issues, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (issues.length === 0) return null;
  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-between w-full text-left mb-3"
      >
        <h3 className="font-semibold text-slate-800">{title} <span className="text-slate-400 font-normal">({issues.length})</span></h3>
        <span className="text-slate-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && issues.map(issue => <IssueCard key={issue.id} issue={issue} />)}
    </div>
  );
}

export default function Report() {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getScanReport(id)
      .then(data => {
        if (data) setReport(data);
        else setError('Report not ready yet.');
      })
      .catch(() => setError('Could not load report.'));
  }, [id]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card text-center max-w-sm">
          <p className="text-slate-600 mb-4">{error}</p>
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

  const critical = report.issues.filter(i => i.severity === 'critical');
  const important = report.issues.filter(i => i.severity === 'important');
  const minor = report.issues.filter(i => i.severity === 'minor');
  const scanDate = report.scannedAt
    ? new Date(report.scannedAt * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center text-white font-bold text-sm">W</div>
            <span className="font-semibold text-slate-800">Website Health Report</span>
          </div>
          <Link to="/" className="text-sm text-brand-600 hover:underline">← New scan</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
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
            </div>
          </div>
        </div>

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

        {/* Issues */}
        {report.totalIssues > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Issues found</h2>
            <IssueSection title="Critical" issues={critical} defaultOpen={true} />
            <IssueSection title="Important" issues={important} defaultOpen={critical.length === 0} />
            <IssueSection title="Minor" issues={minor} defaultOpen={false} />
          </div>
        )}

        {/* Pages crawled — validation table */}
        {report.pages && report.pages.length > 0 && (
          <PagesTable pages={report.pages} />
        )}

        {/* CTA */}
        <div className="card bg-brand-700 text-white border-brand-700">
          <h2 className="text-xl font-bold mb-2">Get this report automatically every week</h2>
          <p className="text-brand-100 text-sm mb-4">
            Know about new issues before your customers do. The same scan, delivered to your inbox every Monday — <strong>$19/site/month</strong>.
          </p>
          <button
            className="bg-white text-brand-700 font-semibold px-5 py-2.5 rounded-lg hover:bg-brand-50 transition-colors text-sm"
            onClick={() => alert('Weekly monitoring coming soon! Check back shortly.')}
          >
            Start weekly monitoring →
          </button>
        </div>
      </main>
    </div>
  );
}
