import { useEffect, useState } from 'react';
import { getMonitoredSites, addMonitoredSite, removeMonitoredSite, updateMonitoredSiteEmails, debugCheckUrl } from '../lib/api.js';

function formatDate(unixTs) {
  if (!unixTs) return '—';
  return new Date(unixTs * 1000).toLocaleString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
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

function EmailEditCell({ siteId, emails, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(emails.join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setError('');
    const list = value.split(',').map(s => s.trim()).filter(Boolean);
    if (list.length === 0) { setError('Enter at least one email.'); return; }
    setSaving(true);
    try {
      await onSave(siteId, list);
      setEditing(false);
    } catch (err) {
      setError(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setValue(emails.join(', '));
    setError('');
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-slate-500 text-xs truncate" title={emails.join(', ')}>{emails.join(', ')}</span>
        <button onClick={() => setEditing(true)} className="text-xs text-brand-600 hover:underline shrink-0">Edit</button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          className="border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 w-64"
          disabled={saving}
          autoFocus
        />
        <button onClick={handleSave} disabled={saving} className="text-xs btn-primary px-2 py-1">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={handleCancel} disabled={saving} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  );
}

function StatusBadge({ status }) {
  if (status === null || status === undefined) {
    return <span className="font-mono text-amber-600 font-semibold">null</span>;
  }
  if (status >= 200 && status < 300) {
    return <span className="font-mono text-green-600 font-semibold">{status}</span>;
  }
  if (status >= 400) {
    return <span className="font-mono text-red-600 font-semibold">{status}</span>;
  }
  return <span className="font-mono text-slate-600 font-semibold">{status}</span>;
}

function UrlChecker({ monitorKey }) {
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function handleCheck(e) {
    e.preventDefault();
    const url = urlInput.trim();
    if (!url) return;
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const data = await debugCheckUrl(monitorKey, url);
      setResult(data);
    } catch (err) {
      setError(err.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  const rows = result ? [
    { label: 'HEAD', data: result.head },
    { label: 'GET', data: result.get },
    { label: 'checkUrl', data: result.checkUrl, highlight: true },
  ] : [];

  return (
    <div className="card">
      <h2 className="font-semibold text-slate-800 mb-1">URL checker</h2>
      <p className="text-slate-500 text-xs mb-4">Test what the scan tool returns for any URL — HEAD, GET, and the merged result it actually records.</p>
      <form onSubmit={handleCheck} className="flex gap-3 mb-4">
        <input
          type="text"
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          placeholder="https://example.com/image.jpg"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !urlInput.trim()} className="btn-primary text-sm whitespace-nowrap">
          {loading ? 'Checking…' : 'Check URL'}
        </button>
      </form>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {result && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-medium uppercase tracking-wide">
                <th className="text-left px-3 py-2">Method / Step</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Final URL</th>
                <th className="text-left px-3 py-2">Redirects</th>
                <th className="text-left px-3 py-2">Time (ms)</th>
                <th className="text-left px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ label, data, highlight }) => (
                <tr key={label} className={`border-t border-slate-100 ${highlight ? 'bg-slate-50 font-semibold' : ''}`}>
                  <td className="px-3 py-2 font-mono text-slate-700">
                    {label}
                    {highlight && <span className="ml-2 text-[10px] text-slate-400 font-normal">(recorded)</span>}
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={data.status} /></td>
                  <td className="px-3 py-2 font-mono text-slate-600 max-w-[300px] truncate" title={data.finalUrl}>{data.finalUrl}</td>
                  <td className="px-3 py-2 text-slate-600">{data.redirectCount ?? 0}</td>
                  <td className="px-3 py-2 text-slate-600">{data.responseMs ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{data.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

  async function handleSaveEmails(id, emails) {
    await updateMonitoredSiteEmails(monitorKey, id, emails);
    setSites(prev => prev.map(s => s.id === id ? { ...s, emails: JSON.stringify(emails) } : s));
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 space-y-6">

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
            <p className="text-xs text-slate-400">First scan will run within 24 hours, then weekly.</p>
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
                    <th className="text-left px-5 py-2.5">User</th>
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
                        <td className="px-5 py-3 font-mono text-xs text-slate-700 max-w-[160px] truncate" title={site.url}>
                          {site.base_domain}
                        </td>
                        <td className="px-5 py-3 text-xs max-w-[160px] truncate">
                          {site.user_id
                            ? <span className="text-slate-600" title={site.user_id}>{site.user_id.length > 20 ? site.user_id.slice(0, 20) + '…' : site.user_id}</span>
                            : <span className="text-slate-400 italic">Admin</span>}
                        </td>
                        <td className="px-5 py-3 max-w-[260px]">
                          <EmailEditCell siteId={site.id} emails={emails} onSave={handleSaveEmails} />
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          {site.pending_scan_id
                            ? <a href={`/scan/${site.pending_scan_id}`} className="text-amber-600 font-medium text-xs hover:underline">Scanning…</a>
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

        {/* URL checker */}
        <UrlChecker monitorKey={monitorKey} />

      </main>
    </div>
  );
}

export default function Monitor() {
  const [monitorKey, setMonitorKey] = useState('');

  function handleSignOut() {
    setMonitorKey('');
  }

  if (!monitorKey) {
    return <LoginForm onSuccess={setMonitorKey} />;
  }

  return <MonitorDashboard monitorKey={monitorKey} onSignOut={handleSignOut} />;
}
