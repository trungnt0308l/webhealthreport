import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getScanReport } from '../lib/api.js';
import { scoreColor, scoreBgColor, severityBadgeClass, gradeDescription } from '../lib/format.js';

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

function shortUrl(url, maxLen = 60) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const full = u.hostname + u.pathname + u.search;
    return full.length > maxLen ? full.slice(0, maxLen) + '…' : full;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen) + '…' : url;
  }
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

function IssueTable({ issues, pages }) {
  const [copiedId, setCopiedId] = useState(null);

  const pageTitle = {};
  for (const p of pages || []) if (p.url) pageTitle[p.url] = p.title;

  function copyUrl(key, url) {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(key);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }

  const groups = [
    { label: 'Critical', items: issues.filter(i => i.severity === 'critical') },
    { label: 'Important', items: issues.filter(i => i.severity === 'important') },
    { label: 'Minor', items: issues.filter(i => i.severity === 'minor') },
  ].filter(g => g.items.length > 0);

  return (
    <div className="mb-8">
      <h2 className="text-lg font-bold text-slate-800 mb-4">Issues found</h2>
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-slate-500 font-medium w-36">Severity</th>
              <th className="text-left px-4 py-2.5 text-slate-500 font-medium w-1/2">Broken URL</th>
              <th className="text-left px-4 py-2.5 text-slate-500 font-medium">Found on</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ label, items }) => (
              <>
                <tr key={label} className="bg-slate-50 border-y border-slate-200">
                  <td colSpan={3} className="px-4 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {label} ({items.length})
                  </td>
                </tr>
                {items.map((issue, idx) => {
                  const brokenUrl = issue.example?.target || issue.example?.url || null;
                  const sourceUrl = Array.isArray(issue.example?.sources)
                    ? (issue.example.sources[0] || null)
                    : (issue.example?.url || null);
                  const tgtKey = `${label}-${idx}-tgt`;
                  return (
                    <tr key={`${label}-${idx}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 align-middle">
                      <td className="px-4 py-3">
                        <span className={severityBadgeClass(issue.severity)}>{issue.severity}</span>
                        <div className="text-xs text-slate-500 mt-1 leading-snug">{ISSUE_LABELS[issue.type] || issue.type}</div>
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

  const scanDate = report.scannedAt
    ? new Date(report.scannedAt * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center text-white font-bold text-sm">W</div>
            <span className="font-semibold text-slate-800">Website Health Report</span>
          </div>
          <Link to="/" className="text-sm text-brand-600 hover:underline">← New scan</Link>
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

        {/* Issues table */}
        {report.totalIssues > 0 && <IssueTable issues={report.issues} pages={report.pages} />}

        {/* Pages crawled */}
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
