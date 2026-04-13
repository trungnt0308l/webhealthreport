import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';
import { startScan } from '../lib/api.js';
import { usePageMeta } from '../hooks/usePageMeta.js';

// Cloudflare Turnstile site key — public, safe to hardcode.
const TURNSTILE_SITE_KEY = '0x4AAAAAAC049iVS5wZ82lGw';

function TurnstileWidget({ onVerify, onExpire }) {
  const containerRef = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    function renderWidget() {
      if (!containerRef.current || widgetId.current !== null) return;
      widgetId.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'light',
        callback: onVerify,
        'expired-callback': onExpire,
      });
    }

    if (window.turnstile) {
      renderWidget();
    } else {
      window._pendingTurnstileRender = renderWidget;
    }

    return () => {
      window._pendingTurnstileRender = null;
      if (widgetId.current !== null && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, []);

  return <div ref={containerRef} className="mt-4 flex justify-center" />;
}

function FAQAccordionItem({ question, answer }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-200 py-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-between w-full text-left gap-4"
      >
        <span className="font-semibold text-slate-800 text-sm">{question}</span>
        <span className="text-slate-400 text-xs flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && <p className="mt-3 text-slate-600 text-sm leading-relaxed">{answer}</p>}
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth0();

  usePageMeta({
    title: 'Website Health Report — Free Website Scanner',
    description: 'Scan your website for broken links, missing pages, and technical issues in minutes. Free, no account required. Checks up to 1,000 pages and 10,000 links.',
    path: '/',
  });

  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'ld-howto';
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      'name': 'How to scan your website for broken links and technical issues',
      'step': [
        { '@type': 'HowToStep', 'name': 'Enter your URL', 'text': 'Paste your website address into the scanner form. No account required.' },
        { '@type': 'HowToStep', 'name': 'Watch the live scan', 'text': 'Monitor real-time progress as every page and link is checked. Most sites complete in under 2 minutes.' },
        { '@type': 'HowToStep', 'name': 'Review your report', 'text': 'See your health score and a prioritised list of issues sorted by severity, each linked back to the page where it was found.' },
      ],
    });
    document.head.appendChild(script);
    return () => document.getElementById('ld-howto')?.remove();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!url.trim()) return;
    if (!token) {
      setError('Please complete the security check.');
      return;
    }

    setLoading(true);
    try {
      const { scanId } = await startScan(url.trim(), token);
      navigate(`/scan/${scanId}`);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      // Reset Turnstile so user can retry
      if (window.turnstile) window.turnstile.reset();
      setToken('');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center text-white font-bold text-sm">W</div>
            <span className="font-semibold text-slate-800">Website Health Report</span>
          </div>
          <nav className="flex items-center gap-5 text-sm">
            <Link to="/faq" className="text-slate-500 hover:text-slate-800 transition-colors">FAQ</Link>
            <Link to="/register" className="btn-primary py-1.5 px-3 text-sm">Get weekly reports</Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center px-6 pt-16 pb-20">
        <div className="max-w-2xl w-full text-center">
          <h1 className="text-4xl font-bold text-slate-900 leading-tight mb-4">
            Scan your website and see<br />what's broken in minutes
          </h1>
          <p className="text-lg text-slate-500 mb-10">
            Enter your URL, watch the scan live, and get a professional report showing broken links,
            missing pages, and the issues that matter most.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3">
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
                disabled={loading || !url.trim() || !token}
                className="btn-primary whitespace-nowrap"
              >
                {loading ? 'Starting…' : 'Scan my site →'}
              </button>
            </div>

            <TurnstileWidget
              onVerify={setToken}
              onExpire={() => setToken('')}
            />
          </form>

          {error && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}

          {isAuthenticated ? (
            <p className="mt-4 text-xs text-slate-400">
              One-off scan — up to <span className="font-medium text-slate-500">500 pages</span> and <span className="font-medium text-slate-500">5,000 links</span>. Your weekly monitored scans check up to 1,000 pages and 10,000 links.
            </p>
          ) : (
            <p className="mt-4 text-xs text-slate-400">
              Free scan — no account required. Up to <span className="font-medium text-slate-500">500 pages</span> and <span className="font-medium text-slate-500">5,000 links</span>.{' '}
              <Link to="/register" className="text-brand-600 hover:underline">Create an account</Link> to add weekly monitoring from <span className="font-medium text-slate-500">$9/month</span>.
            </p>
          )}
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
        {/* How it works */}
        <div className="max-w-2xl w-full mt-24">
          <h2 className="text-2xl font-bold text-slate-900 mb-2 text-center">How it works</h2>
          <p className="text-slate-500 text-center mb-8 text-sm">Three steps. No account needed.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { num: '1', title: 'Enter your URL', desc: 'Paste any publicly accessible website address. We handle the rest.' },
              { num: '2', title: 'Watch the live scan', desc: 'See every page and link being checked in real time. Most sites finish in under 2 minutes.' },
              { num: '3', title: 'Get your report', desc: 'Review your health score and a prioritised list of issues, each linked to the page where it was found.' },
            ].map(s => (
              <div key={s.num} className="card flex flex-col gap-3">
                <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-sm flex-shrink-0">{s.num}</div>
                <div>
                  <div className="font-semibold text-slate-800 mb-1">{s.title}</div>
                  <div className="text-sm text-slate-500">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* What we check */}
        <div className="max-w-2xl w-full mt-20">
          <h2 className="text-2xl font-bold text-slate-900 mb-2 text-center">What we check</h2>
          <p className="text-slate-500 text-center mb-8 text-sm">Eight categories of issues, ranked by severity.</p>
          <div className="card p-0 overflow-hidden divide-y divide-slate-100">
            {[
              { label: 'Broken internal links', desc: 'Links within your site that return 4xx or 5xx errors, blocking visitors and search crawlers.' },
              { label: 'Broken external links', desc: 'Outbound links to pages that no longer exist — a credibility risk and a crawl-budget waste.' },
              { label: 'Broken images', desc: 'Images that fail to load, leaving blank spaces and degrading the user experience.' },
              { label: 'Redirect chains', desc: 'URLs that redirect through multiple hops before reaching the final destination, slowing page loads.' },
              { label: 'Missing page titles', desc: 'Pages with a blank or absent <title> tag — a direct ranking signal for search engines.' },
              { label: 'Thin pages', desc: 'Pages with very little content that may be seen as low-quality by search engines.' },
              { label: 'Slow pages', desc: 'Pages taking over 3 seconds to respond, which increases bounce rate and hurts SEO.' },
              { label: 'Homepage unavailable', desc: 'Your root URL is unreachable or returns an error — the most critical issue a site can have.' },
            ].map(item => (
              <div key={item.label} className="flex gap-4 px-5 py-4">
                <span className="font-semibold text-slate-800 text-sm w-44 flex-shrink-0">{item.label}</span>
                <span className="text-sm text-slate-500">{item.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Why regular scanning matters */}
        <div className="max-w-2xl w-full mt-20">
          <h2 className="text-2xl font-bold text-slate-900 mb-2 text-center">Why regular scanning matters</h2>
          <p className="text-slate-500 text-center mb-8 text-sm">Issues accumulate silently. Catch them before your customers do.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[
              { icon: '📉', title: 'Broken links hurt your rankings', desc: 'Search engines count crawl errors against your site. A single broken internal link can prevent a page from being indexed.' },
              { icon: '🚪', title: 'Broken links lose customers', desc: 'A 404 page is a dead end. Users who hit broken links bounce immediately and rarely return.' },
              { icon: '🔔', title: 'Catch problems before customers do', desc: 'A link that worked last month may have broken when a vendor updated their site. Weekly monitoring finds it first.' },
              { icon: '📋', title: 'Reports your team can act on', desc: 'Every issue links back to the page it was found on. A clear to-do list sorted by severity, not a wall of data.' },
            ].map(b => (
              <div key={b.title} className="card flex flex-col gap-2">
                <div className="text-2xl">{b.icon}</div>
                <div className="font-semibold text-slate-800">{b.title}</div>
                <div className="text-sm text-slate-500">{b.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Pricing */}
        <div className="max-w-2xl w-full mt-24">
          <h2 className="text-2xl font-bold text-slate-900 mb-2 text-center">Simple, transparent pricing</h2>
          <p className="text-slate-500 text-center mb-8 text-sm">One-off scans are always free. Add weekly monitoring for a flat monthly fee.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Free tier */}
            <div className="card flex flex-col gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">One-off scan</p>
                <p className="text-3xl font-bold text-slate-900">Free</p>
                <p className="text-sm text-slate-500 mt-1">No account required</p>
              </div>
              <ul className="space-y-2 text-sm text-slate-600 flex-1">
                {['Up to 500 pages per scan', 'Up to 5,000 links checked', 'Full issue report with health score', 'Instant results'].map(f => (
                  <li key={f} className="flex items-start gap-2"><span className="text-green-500 font-bold mt-0.5">✓</span>{f}</li>
                ))}
              </ul>
              <Link to="/" className="btn-secondary text-center text-sm">Scan my site →</Link>
            </div>

            {/* Paid tier */}
            <div className="card flex flex-col gap-4 border-2 border-brand-500 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-xs font-semibold px-3 py-1 rounded-full">Early access</div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Weekly monitoring</p>
                <p className="text-3xl font-bold text-slate-900">
                  $9<span className="text-lg font-normal text-slate-500">/month</span>
                </p>
                <p className="text-sm text-slate-400 mt-1">
                  <span className="line-through">$19/month</span> — limited time offer
                </p>
              </div>
              <ul className="space-y-2 text-sm text-slate-600 flex-1">
                {[
                  'Per site, billed monthly',
                  'Up to 1,000 pages per scan',
                  'Up to 10,000 links checked',
                  'Weekly automated scans',
                  'Email alerts when issues appear',
                  'Cancel anytime',
                ].map(f => (
                  <li key={f} className="flex items-start gap-2"><span className="text-green-500 font-bold mt-0.5">✓</span>{f}</li>
                ))}
              </ul>
              <Link to="/register" className="btn-primary text-center text-sm">Get weekly reports →</Link>
            </div>
          </div>
        </div>

        {/* FAQ teaser */}
        <div className="max-w-2xl w-full mt-20">
          <h2 className="text-2xl font-bold text-slate-900 mb-2 text-center">Common questions</h2>
          <p className="text-slate-500 text-center mb-8 text-sm">Quick answers — or see the full FAQ.</p>
          <div className="card">
            {[
              { question: 'Is one-off scanning really free?', answer: 'Yes. One-off scans are completely free with no account required — just paste your URL and go. Scans check up to 500 pages and 5,000 links.' },
              { question: 'How much does weekly monitoring cost?', answer: 'Weekly monitoring is $9/month per site — currently discounted from $19/month. You are only charged for sites you actively monitor, and you can cancel at any time from your account page.' },
              { question: 'How long does a scan take?', answer: 'Most sites complete in 30 seconds to 2 minutes. Larger sites with hundreds of pages may take a little longer, but you can watch the progress live.' },
              { question: 'What is weekly monitoring?', answer: 'Weekly monitoring automatically scans your site once a week and emails you a report when new issues are found. Monitored scans check up to 1,000 pages and 10,000 links — twice the free scan limit.' },
            ].map(faq => (
              <FAQAccordionItem key={faq.question} question={faq.question} answer={faq.answer} />
            ))}
            <div className="pt-4">
              <Link to="/faq" className="text-sm text-brand-600 hover:underline">See all FAQs →</Link>
            </div>
          </div>
        </div>
      </main>

      <footer className="text-center text-xs text-slate-400 py-6 border-t border-slate-100">
        Website Health Report — checks up to 1,000 pages per scan &nbsp;·&nbsp;
        <Link to="/faq" className="hover:text-slate-600 underline">FAQ</Link>
      </footer>
    </div>
  );
}
