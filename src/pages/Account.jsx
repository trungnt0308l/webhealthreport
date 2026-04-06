import { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { getUserSites, addUserSite, removeUserSite, updateUserSiteEmails } from '../lib/api.js';

function formatDate(unixTs) {
  if (!unixTs) return '—';
  return new Date(unixTs * 1000).toLocaleString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function Header({ onLogout }) {
  return (
    <header className="border-b border-slate-200 bg-white px-6 py-4">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <a href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center text-white font-bold text-sm">W</div>
            <span className="font-semibold text-slate-800">Website Health Report</span>
          </a>
        </div>
        <button
          onClick={onLogout}
          className="text-sm text-slate-500 hover:text-slate-700 hover:underline"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

function ProfileCard({ user }) {
  const isGoogle = user.sub?.startsWith('google-oauth2|');

  return (
    <div className="card">
      <h2 className="font-semibold text-slate-800 mb-4">Profile</h2>
      <div className="flex items-center gap-4">
        {user.picture && (
          <img
            src={user.picture}
            alt={user.name || user.email}
            className="w-14 h-14 rounded-full border border-slate-200"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-800 truncate">{user.name || user.email}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isGoogle ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
              {isGoogle ? 'Google' : 'Email'}
            </span>
            {user.email_verified
              ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">Verified</span>
              : <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">Unverified</span>
            }
          </div>
          <p className="text-sm text-slate-500 mt-0.5 truncate">{user.email}</p>
        </div>
      </div>
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
      <div className="flex items-center gap-2 flex-wrap">
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

function SitesSection({ token, userEmail }) {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formUrl, setFormUrl] = useState('');
  const [formEmails, setFormEmails] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  async function loadSites() {
    setLoading(true);
    try {
      const data = await getUserSites(token);
      setSites(data.sites || []);
    } catch {
      // ignore transient errors
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSites(); }, [token]);

  async function handleAdd(e) {
    e.preventDefault();
    setFormError('');
    if (!formUrl.trim()) return;

    // If extra emails entered, parse them; otherwise default to user's own email (API handles this)
    const emailList = formEmails.trim()
      ? formEmails.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    setFormLoading(true);
    try {
      await addUserSite(token, formUrl.trim(), emailList.length > 0 ? emailList : undefined);
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
      await removeUserSite(token, id);
      setSites(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      alert(err.message || 'Failed to remove site.');
    }
  }

  async function handleSaveEmails(id, emails) {
    await updateUserSiteEmails(token, id, emails);
    setSites(prev => prev.map(s => s.id === id ? { ...s, emails: JSON.stringify(emails) } : s));
  }

  return (
    <div className="space-y-4">
      {/* Add site form */}
      <div className="card">
        <h2 className="font-semibold text-slate-800 mb-1">Monitor a website</h2>
        <p className="text-sm text-slate-500 mb-4">
          Weekly health reports will be sent to <strong>{userEmail}</strong>.
        </p>
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
              placeholder="Extra notification emails (optional)"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              disabled={formLoading}
            />
            <button
              type="submit"
              disabled={formLoading || !formUrl.trim()}
              className="btn-primary text-sm whitespace-nowrap"
            >
              {formLoading ? 'Adding…' : 'Add site'}
            </button>
          </div>
          {formError && <p className="text-red-600 text-sm">{formError}</p>}
          <p className="text-xs text-slate-400">First scan runs within 24 hours, then weekly thereafter.</p>
        </form>
      </div>

      {/* Sites table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 text-sm">Your monitored sites</h2>
          <span className="text-xs text-slate-400">{sites.length} site{sites.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center text-slate-400 text-sm">Loading…</div>
        ) : sites.length === 0 ? (
          <div className="px-5 py-8 text-center text-slate-400 text-sm">
            No sites added yet. Add one above to start monitoring.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500 font-medium uppercase tracking-wide">
                  <th className="text-left px-5 py-2.5">Domain</th>
                  <th className="text-left px-5 py-2.5">Notification emails</th>
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
                    <td className="px-5 py-3 max-w-[260px]">
                      <EmailEditCell siteId={site.id} emails={emails} onSave={handleSaveEmails} />
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
                      {site.pending_scan_id ? '—' : formatDate(site.next_scan_at)}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {site.last_scan_id
                        ? <a href={`/report/${site.last_scan_id}`} className="text-brand-600 hover:underline text-sm">View report</a>
                        : <span className="text-slate-400 text-sm">—</span>}
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
    </div>
  );
}

export default function Account() {
  const { user, logout, getAccessTokenSilently } = useAuth0();
  const [token, setToken] = useState(null);
  const [tokenError, setTokenError] = useState(false);

  useEffect(() => {
    getAccessTokenSilently()
      .then(setToken)
      .catch(() => setTokenError(true));
  }, [getAccessTokenSilently]);

  function handleLogout() {
    logout({ logoutParams: { returnTo: window.location.origin } });
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header onLogout={handleLogout} />
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 space-y-6">

        {user && <ProfileCard user={user} />}

        {tokenError ? (
          <div className="card text-red-600 text-sm">
            Could not load your session. Please sign out and sign in again.
          </div>
        ) : token ? (
          <SitesSection token={token} userEmail={user?.email || ''} />
        ) : (
          <div className="card text-center text-slate-400 text-sm py-8">Loading…</div>
        )}

      </main>
    </div>
  );
}
