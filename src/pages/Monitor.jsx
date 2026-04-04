import { useEffect, useState } from 'react';
import { getMonitoredSites, addMonitoredSite, removeMonitoredSite } from '../lib/api.js';

const SESSION_KEY = 'monitor_key';

function formatDate(unixTs) {
  if (!unixTs) return '—';
  return new Date(unixTs * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Header() {
  return (
    <header className="border-b border-slate-200 bg-white px-6 py-4">
      <div className="max-w-5xl mx-auto flex items-center gap-2">
        <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center text-white font-bold text-sm">W</div>
        <span className="font-semibold text-slate-800">Website Health Report</span>
        <span className="ml-2 text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded">Admin</span>
      </div>
    </header>
  );
}

function LoginForm({ onSuccess }) {
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const k = keyInput.trim();
    if (!k) return;
    setLoading(true);
    try {
      await getMonitoredSites(k);
      sessionStorage.setItem(SESSION_KEY, k);
      onSuccess(k);
    } catch (err) {
      setError(err.status === 403 ? 'Invalid key.' : 'Could not connect. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="card max-w-sm w-full">
          <h2 className="font-semibold text-slate-800 mb-1">Admin access</h2>
          <p className="text-slate-500 text-sm mb-5">Enter your monitor key to manage scheduled scans.</p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="Monitor key"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              autoFocus
              disabled={loading}
            />
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button type="submit" disabled={loading || !keyInput.trim()} className="btn-primary w-full text-sm">
              {loading ? 'Checking…' : 'Sign in'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

function MonitorDashboard({ monitorKey, onSignOut }) {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formUrl, setFormUrl] = useState('');
  const [formEmails, setFormEmails] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  async function loadSites() {
    setLoading(true);
    try {
      const data = await getMonitoredSites(monitorKey);
      setSites(data.sites || []);
    } catch {
      // key was valid on login; ignore transient errors
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSites(); }, []);

  async function handleAdd(e) {
    e.preventDefault();
    setFormError('');
    if (!formUrl.trim()) return;
    const emailList = formEmails.split(',').map(s => s.trim()).filter(Boolean);
    if (emailList.length === 0) { setFormError('Enter at least one email address.'); return; }

    setFormLoading(true);
    try {
      await addMonitoredSite(monitorKey, formUrl.trim(), emailList);
      setFormUrl('');
      setFormEmails('');
      await loadSites();
    } catch (err) {
      setFormError(err.message || 'Failed to add site.');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleRemove(id) {
    if (!confirm('Remove this site from monitoring?')) return;
    try {
      await removeMonitoredSite(monitorKey, id);
      setSites(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      alert(err.message || 'Failed to remove site.');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header />
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 space-y-6">

        {/* Add site form */}
        <div className="card">
          <h2 className="font-semibold text-slate-800 mb-4">Add site to monitoring</h2>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={formUrl}
                onChange={e => setFormUrl(e.target.value)}
                placeholder="https://example.com"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                disabled={formLoading}
              />
              <input
                type="text"
                value={formEmails}
                onChange={e => setFormEmails(e.target.value)}
                placeholder="email@example.com, another@example.com"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                disabled={formLoading}
              />
              <button type="submit" disabled={formLoading || !formUrl.trim()} className="btn-primary text-sm whitespace-nowrap">
                {formLoading ? 'Adding…' : 'Add site'}
              </button>
            </div>
            {formError && <p className="text-red-600 text-sm">{formError}</p>}
            <p className="text-xs text-slate-400">First scan will run within 7 days, then weekly.</p>
          </form>
        </div>

        {/* Sites table */}
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 text-sm">Monitored sites</h2>
            <div className="flex items-center gap-4">
              <span className="text-xs text-slate-400">{sites.length} site{sites.length !== 1 ? 's' : ''}</span>
              <button onClick={onSignOut} className="text-xs text-slate-400 hover:text-slate-600 hover:underline">Sign out</button>
            </div>
          </div>

          {loading ? (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">Loading…</div>
          ) : sites.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">No sites added yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs text-slate-500 font-medium uppercase tracking-wide">
                    <th className="text-left px-5 py-2.5">Domain</th>
                    <th className="text-left px-5 py-2.5">Emails</th>
                    <th className="text-left px-5 py-2.5">Status</th>
                    <th className="text-left px-5 py-2.5">Next scan</th>
                    <th className="text-left px-5 py-2.5">Last report</th>
                    <th className="px-5 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map(site => {
                    const emails = JSON.parse(site.emails || '[]');
                    return (
                      <tr key={site.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-5 py-3 font-mono text-xs text-slate-700 max-w-[200px] truncate" title={site.url}>
                          {site.base_domain}
                        </td>
                        <td className="px-5 py-3 text-slate-500 text-xs max-w-[220px] truncate" title={emails.join(', ')}>
                          {emails.join(', ')}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          {site.pending_scan_id
                            ? <span className="text-amber-600 font-medium text-xs">Scanning…</span>
                            : site.last_scan_status === 'success'
                              ? <span className="text-green-600 text-xs font-medium">OK</span>
                              : site.last_scan_status === 'failed'
                                ? <span className="text-red-500 text-xs font-medium" title={site.last_scan_error || ''}>Failed{site.last_scan_error ? ' ⓘ' : ''}</span>
                                : <span className="text-slate-400 text-xs">Never run</span>}
                        </td>
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap text-sm">
                          {site.pending_scan_id
                            ? '—'
                            : formatDate(site.next_scan_at)}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          {site.last_scan_id
                            ? <a href={`/report/${site.last_scan_id}`} className="text-brand-600 hover:underline text-sm">View report</a>
                            : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => handleRemove(site.id)}
                            className="text-xs text-red-500 hover:text-red-700 hover:underline"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function Monitor() {
  const [monitorKey, setMonitorKey] = useState(() => sessionStorage.getItem(SESSION_KEY) || '');

  function handleSignOut() {
    sessionStorage.removeItem(SESSION_KEY);
    setMonitorKey('');
  }

  if (!monitorKey) {
    return <LoginForm onSuccess={setMonitorKey} />;
  }

  return <MonitorDashboard monitorKey={monitorKey} onSignOut={handleSignOut} />;
}
