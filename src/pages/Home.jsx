import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startScan } from '../lib/api.js';

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!url.trim()) return;

    setLoading(true);
    try {
      const { scanId } = await startScan(url.trim());
      navigate(`/scan/${scanId}`);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-2">
          <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center text-white font-bold text-sm">W</div>
          <span className="font-semibold text-slate-800">Website Health Report</span>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="max-w-2xl w-full text-center">
          <h1 className="text-4xl font-bold text-slate-900 leading-tight mb-4">
            Scan your website and see<br />what's broken in minutes
          </h1>
          <p className="text-lg text-slate-500 mb-10">
            Enter your URL, watch the scan live, and get a professional report showing broken links,
            missing pages, and the issues that matter most.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://yourwebsite.com"
              className="flex-1 border border-slate-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              disabled={loading}
              autoFocus
            />
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="btn-primary whitespace-nowrap"
            >
              {loading ? 'Starting…' : 'Scan my site →'}
            </button>
          </form>

          {error && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}

          <p className="mt-4 text-xs text-slate-400">
            Free scan — no account required. We check up to 1,000 pages and 10,000 links.
          </p>
        </div>

        {/* Feature bullets */}
        <div className="max-w-2xl w-full mt-20 grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
          {[
            { icon: '🔍', title: 'Live scan progress', desc: 'Watch pages and links being checked in real time.' },
            { icon: '📋', title: 'Clear report', desc: 'Issues ranked by severity with plain-English explanations.' },
            { icon: '⚡', title: 'Instant results', desc: 'No account needed. Paste your URL and go.' },
          ].map(f => (
            <div key={f.title} className="card">
              <div className="text-2xl mb-2">{f.icon}</div>
              <div className="font-semibold text-slate-800 mb-1">{f.title}</div>
              <div className="text-sm text-slate-500">{f.desc}</div>
            </div>
          ))}
        </div>
      </main>

      <footer className="text-center text-xs text-slate-400 py-6 border-t border-slate-100">
        Website Health Report — checks up to 1,000 pages per scan
      </footer>
    </div>
  );
}
