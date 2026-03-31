import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getScanStatus } from '../lib/api.js';

const STEPS = [
  'Starting scan',
  'Checking homepage',
  'Discovering pages',
  'Crawling pages',
  'Checking internal pages',
  'Checking external links',
  'Checking images',
  'Analyzing issues',
  'Building report',
  'Complete',
];

function stepIndex(label) {
  const idx = STEPS.findIndex(s => s.toLowerCase() === label?.toLowerCase());
  return idx === -1 ? 1 : idx;
}

function statusColor(code) {
  if (code === null || code === undefined) return 'text-slate-400';
  if (code < 300) return 'text-green-600';
  if (code < 400) return 'text-amber-500';
  return 'text-red-500';
}

function typeLabel(type) {
  if (type === 'internal') return 'page';
  if (type === 'image') return 'img';
  return 'ext';
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    const full = u.hostname + u.pathname;
    return full.length > 55 ? full.slice(0, 55) + '…' : full;
  } catch {
    return url.length > 55 ? url.slice(0, 55) + '…' : url;
  }
}

export default function ScanProgress() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const intervalRef = useRef(null);
  const dotCount = useRef(0);
  const [dots, setDots] = useState('');

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const data = await getScanStatus(id);
        if (!active) return;
        setStatus(data);

        if (data.status === 'complete') {
          clearInterval(intervalRef.current);
          setTimeout(() => navigate(`/report/${id}`), 800);
        } else if (data.status === 'failed') {
          clearInterval(intervalRef.current);
          setError('The scan could not complete. The site may be unreachable.');
        }
      } catch {
        if (!active) return;
        setError('Lost connection. Please refresh to resume.');
        clearInterval(intervalRef.current);
      }
    }

    poll();
    intervalRef.current = setInterval(poll, 2000);

    const dotTimer = setInterval(() => {
      dotCount.current = (dotCount.current + 1) % 4;
      setDots('.'.repeat(dotCount.current));
    }, 400);

    return () => {
      active = false;
      clearInterval(intervalRef.current);
      clearInterval(dotTimer);
    };
  }, [id, navigate]);

  const currentStep = status?.currentStep || 'Starting scan';
  const stepIdx = stepIndex(currentStep);
  const progress = status?.status === 'complete' ? 100 : Math.round((stepIdx / (STEPS.length - 1)) * 90);
  const recentChecks = status?.recentChecks || [];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-2">
          <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center text-white font-bold text-sm">W</div>
          <span className="font-semibold text-slate-800">Website Health Report</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center px-6 py-10">
        <div className="max-w-2xl w-full space-y-4">
          {error ? (
            <div className="card text-center">
              <div className="text-3xl mb-3">⚠️</div>
              <h2 className="text-lg font-semibold text-slate-800 mb-2">Scan stopped</h2>
              <p className="text-slate-500 text-sm">{error}</p>
              <a href="/" className="mt-4 inline-block text-brand-600 text-sm hover:underline">← Start a new scan</a>
            </div>
          ) : (
            <>
              {/* Main progress card */}
              <div className="card">
                <div className="flex items-center gap-4 mb-4">
                  {status?.status !== 'complete' && (
                    <div className="w-8 h-8 shrink-0 rounded-full border-4 border-brand-100 border-t-brand-600 animate-spin" />
                  )}
                  <div>
                    <div className="font-semibold text-slate-800">
                      {status?.status === 'complete' ? 'Scan complete!' : `${currentStep}${dots}`}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {status?.status === 'complete' ? 'Preparing report…' : 'Keep this tab open'}
                    </div>
                  </div>
                </div>

                <div className="w-full bg-slate-100 rounded-full h-1.5 mb-4">
                  <div
                    className="bg-brand-600 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-slate-800">{status?.pagesCrawled ?? '—'}</div>
                    <div className="text-xs text-slate-400 mt-0.5">Pages crawled</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-slate-800">{status?.linksChecked ?? '—'}</div>
                    <div className="text-xs text-slate-400 mt-0.5">Links checked</div>
                  </div>
                  <div>
                    <div className={`text-2xl font-bold ${status?.issuesFound > 0 ? 'text-red-500' : 'text-slate-800'}`}>
                      {status?.issuesFound ?? '—'}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {status?.errorsAreLive ? 'Errors seen' : 'Issues found'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Live URL feed */}
              {recentChecks.length > 0 && (
                <div className="card">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Live checks</div>
                  <div className="space-y-1.5">
                    {recentChecks.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs font-mono">
                        <span className={`font-bold w-8 shrink-0 ${statusColor(c.status)}`}>
                          {c.status ?? '???'}
                        </span>
                        <span className="text-slate-300 w-7 shrink-0">{typeLabel(c.type)}</span>
                        <span className="text-slate-600 truncate flex-1">{shortUrl(c.url)}</span>
                        {c.ms > 0 && (
                          <span className="text-slate-400 shrink-0">{c.ms}ms</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
