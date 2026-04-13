import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import {
  getUserSites, removeUserSite, updateUserSiteEmails,
  getSubscription, createPayPalSubscription, activateSubscription,
  cancelSubscription, createProRateOrder, captureProRateOrder,
} from '../lib/api.js';

const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID;

function formatDate(unixTs) {
  if (!unixTs) return '—';
  return new Date(unixTs * 1000).toLocaleString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDateShort(unixTs) {
  if (!unixTs) return '—';
  return new Date(unixTs * 1000).toLocaleDateString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Dynamically load the PayPal JS SDK for subscriptions
function loadPayPalSDK() {
  return new Promise((resolve, reject) => {
    if (window.paypal) { resolve(window.paypal); return; }
    const existing = document.getElementById('paypal-sdk-script');
    if (existing) { existing.addEventListener('load', () => resolve(window.paypal)); return; }
    const script = document.createElement('script');
    script.id = 'paypal-sdk-script';
    script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&vault=true&intent=subscription`;
    script.onload = () => resolve(window.paypal);
    script.onerror = () => reject(new Error('Failed to load PayPal SDK'));
    document.head.appendChild(script);
  });
}

function Header({ onLogout }) {
  return (
    <header className="border-b border-slate-200 bg-white px-6 py-4">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <a href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 bg-brand-600 rounded-md flex items-center justify-center text-white font-bold text-sm">W</div>
          <span className="font-semibold text-slate-800">Website Health Report</span>
        </a>
        <button onClick={onLogout} className="text-sm text-slate-500 hover:text-slate-700 hover:underline">
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
          <img src={user.picture} alt={user.name || user.email}
            className="w-14 h-14 rounded-full border border-slate-200" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-800 truncate">{user.name || user.email}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isGoogle ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
              {isGoogle ? 'Google' : 'Email'}
            </span>
            {user.email_verified
              ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">Verified</span>
              : <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">Unverified</span>}
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
    try { await onSave(siteId, list); setEditing(false); }
    catch (err) { setError(err.message || 'Failed to save.'); }
    finally { setSaving(false); }
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
        <input type="text" value={value} onChange={e => setValue(e.target.value)}
          className="border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 w-64"
          disabled={saving} autoFocus />
        <button onClick={handleSave} disabled={saving} className="text-xs btn-primary px-2 py-1">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={() => { setValue(emails.join(', ')); setError(''); setEditing(false); }}
          disabled={saving} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  );
}

// ── Subscription status card ───────────────────────────────────────────────

function SubscriptionCard({ subscription, onCancel, onManage }) {
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    if (!confirm('Cancel your subscription? Your sites will remain active for 3 more days, then monitoring pauses.')) return;
    setCancelling(true);
    try { await onCancel(); } finally { setCancelling(false); }
  }

  if (!subscription) {
    return (
      <div className="card border border-brand-100 bg-brand-50/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-slate-800 mb-1">Website Monitoring</h2>
            <p className="text-sm text-slate-600">
              Monitor your websites with weekly health reports and email alerts.
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-3">
              <span className="line-through text-slate-400 text-lg font-normal mr-2">$19</span>
              $9<span className="text-base font-normal text-slate-500">/month per site</span>
            </p>
            <p className="text-xs text-slate-400 mt-1">Add your first site below to subscribe.</p>
          </div>
        </div>
      </div>
    );
  }

  if (subscription.status === 'grace_period') {
    const endsAt = subscription.grace_period_ends_at;
    const daysLeft = endsAt ? Math.max(0, Math.ceil((endsAt - Date.now() / 1000) / 86400)) : 0;
    return (
      <div className="card border border-amber-200 bg-amber-50">
        <div className="flex items-start gap-3">
          <span className="text-amber-500 text-xl">⚠</span>
          <div className="flex-1">
            <p className="font-semibold text-amber-800">Payment failed</p>
            <p className="text-sm text-amber-700 mt-0.5">
              Your sites will be paused in <strong>{daysLeft} day{daysLeft !== 1 ? 's' : ''}</strong> if payment is not resolved.
            </p>
            <a href="https://www.paypal.com/myaccount/autopay" target="_blank" rel="noopener noreferrer"
              className="inline-block mt-2 text-sm font-medium text-amber-800 underline hover:text-amber-900">
              Update payment in PayPal →
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (subscription.status === 'suspended' || subscription.status === 'cancelled') {
    return (
      <div className="card border border-red-100 bg-red-50/40">
        <p className="font-semibold text-red-700">Subscription {subscription.status}</p>
        <p className="text-sm text-slate-600 mt-1">Your sites are paused. Add a new site to re-subscribe.</p>
      </div>
    );
  }

  // Active subscription
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-slate-800 mb-1">Active plan</h2>
          <p className="text-sm text-slate-600">
            <span className="font-medium text-slate-800">${9 * subscription.site_count}</span>/month
            — {subscription.site_count} site{subscription.site_count !== 1 ? 's' : ''} × $9
          </p>
          {subscription.next_billing_date && (
            <p className="text-xs text-slate-400 mt-1">
              Next billing: {formatDateShort(subscription.next_billing_date)}
            </p>
          )}
        </div>
        <button onClick={handleCancel} disabled={cancelling}
          className="text-xs text-red-500 hover:text-red-700 hover:underline shrink-0 mt-1">
          {cancelling ? 'Cancelling…' : 'Cancel subscription'}
        </button>
      </div>
    </div>
  );
}

// ── PayPal subscription buttons (first site) ──────────────────────────────

function PayPalSubscriptionButtons({ token, url, emails, onSuccess, onError }) {
  const containerRef = useRef(null);
  const rendered     = useRef(false);

  useEffect(() => {
    if (rendered.current || !containerRef.current) return;
    rendered.current = true;

    loadPayPalSDK().then(PP => {
      PP.Buttons({
        style: { shape: 'rect', color: 'gold', layout: 'vertical', label: 'subscribe' },
        createSubscription: async (_data, _actions) => {
          const { subscriptionId } = await createPayPalSubscription(token);
          return subscriptionId;
        },
        onApprove: async (data) => {
          try {
            await activateSubscription(token, data.subscriptionID, url, emails);
            onSuccess();
          } catch (err) {
            onError(err.message || 'Activation failed');
          }
        },
        onError: (err) => {
          console.error('PayPal error:', err);
          onError('PayPal encountered an error. Please try again.');
        },
        onCancel: () => {
          onError('');
        },
      }).render(containerRef.current);
    }).catch(() => onError('Failed to load PayPal. Please refresh.'));

    return () => { rendered.current = false; };
  }, []);

  return <div ref={containerRef} className="mt-4" />;
}

// ── First-site subscription modal ─────────────────────────────────────────

function SubscriptionModal({ token, userEmail, onSuccess, onClose }) {
  const [url, setUrl]       = useState('');
  const [emails, setEmails] = useState('');
  const [step, setStep]     = useState('form'); // 'form' | 'paypal' | 'processing'
  const [error, setError]   = useState('');

  const parsedEmails = emails.trim()
    ? emails.split(',').map(s => s.trim()).filter(Boolean)
    : [userEmail];

  function handleNext(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setError('');
    setStep('paypal');
  }

  function handleSuccess() {
    setStep('processing');
    onSuccess();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Start monitoring</h2>
              <p className="text-sm text-slate-500 mt-0.5">Weekly scans · Email alerts · Issue history</p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">$9</span>
            <span className="text-slate-500">/month per site</span>
            <span className="line-through text-slate-400 text-sm">$19</span>
          </div>
        </div>

        <div className="p-6">
          {step === 'form' && (
            <form onSubmit={handleNext} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">Website URL</label>
                <input type="text" value={url} onChange={e => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">
                  Notification emails <span className="text-slate-400 font-normal">(optional, comma-separated)</span>
                </label>
                <input type="text" value={emails} onChange={e => setEmails(e.target.value)}
                  placeholder={userEmail}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              <button type="submit" disabled={!url.trim()} className="btn-primary w-full text-sm py-2.5">
                Continue to payment
              </button>
            </form>
          )}

          {step === 'paypal' && (
            <div>
              <div className="bg-slate-50 rounded-lg p-3 mb-4 text-sm text-slate-600">
                <p className="font-medium text-slate-800 truncate">{url}</p>
                <p className="text-xs text-slate-400 mt-0.5">Alerts to: {parsedEmails.join(', ')}</p>
              </div>
              {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
              <PayPalSubscriptionButtons
                token={token}
                url={url.trim()}
                emails={parsedEmails}
                onSuccess={handleSuccess}
                onError={setError}
              />
              <button onClick={() => setStep('form')}
                className="mt-3 text-xs text-slate-400 hover:text-slate-600 w-full text-center">
                ← Back
              </button>
            </div>
          )}

          {step === 'processing' && (
            <div className="text-center py-4">
              <p className="text-slate-600 text-sm">Setting up your monitoring…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Pro-rate modal (subsequent sites) ─────────────────────────────────────

function AddSiteModal({ token, userEmail, onSuccess, onClose }) {
  const [url, setUrl]           = useState('');
  const [emails, setEmails]     = useState('');
  const [step, setStep]         = useState('form'); // 'form' | 'confirm' | 'redirecting'
  const [orderInfo, setOrderInfo] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const parsedEmails = emails.trim()
    ? emails.split(',').map(s => s.trim()).filter(Boolean)
    : [userEmail];

  async function handleGetQuote(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setError('');
    setLoading(true);
    try {
      const data = await createProRateOrder(token, url.trim(), parsedEmails);
      setOrderInfo(data);
      setStep('confirm');
    } catch (err) {
      setError(err.message || 'Failed to calculate charge');
    } finally {
      setLoading(false);
    }
  }

  function handlePayWithPayPal() {
    if (!orderInfo?.orderId || !orderInfo?.approveUrl) return;
    // Store orderId for capture after redirect
    sessionStorage.setItem('paypal_order_id', orderInfo.orderId);
    setStep('redirecting');
    window.location.href = orderInfo.approveUrl;
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Add a site</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="p-6">
          {step === 'form' && (
            <form onSubmit={handleGetQuote} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">Website URL</label>
                <input type="text" value={url} onChange={e => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">
                  Notification emails <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input type="text" value={emails} onChange={e => setEmails(e.target.value)}
                  placeholder={userEmail}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <button type="submit" disabled={loading || !url.trim()} className="btn-primary w-full text-sm py-2.5">
                {loading ? 'Calculating…' : 'Calculate charge'}
              </button>
              <p className="text-xs text-slate-400 text-center">$9/month per site — prorated for this billing period</p>
            </form>
          )}

          {step === 'confirm' && orderInfo && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-sm font-medium text-slate-800 truncate">{url}</p>
                <p className="text-xs text-slate-500 mt-0.5">Alerts to: {parsedEmails.join(', ')}</p>
              </div>
              <div className="border border-slate-200 rounded-lg p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Today (prorated — {orderInfo.daysRemaining} days left)</span>
                  <span className="font-semibold text-slate-800">${orderInfo.proratedAmount}</span>
                </div>
                <div className="flex justify-between text-sm mt-2 text-slate-400">
                  <span>Next month onward</span>
                  <span>$9.00</span>
                </div>
              </div>
              <button onClick={handlePayWithPayPal} className="btn-primary w-full text-sm py-2.5">
                Pay ${orderInfo.proratedAmount} with PayPal
              </button>
              <button onClick={() => { setStep('form'); setOrderInfo(null); }}
                className="text-xs text-slate-400 hover:text-slate-600 w-full text-center">
                ← Back
              </button>
            </div>
          )}

          {step === 'redirecting' && (
            <div className="text-center py-6">
              <p className="text-slate-600 text-sm">Redirecting to PayPal…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sites section ─────────────────────────────────────────────────────────

function SitesSection({ token, userEmail, subscription, onSubscriptionChange }) {
  const [sites, setSites]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [showModal, setShowModal]       = useState(false);
  const [captureStatus, setCaptureStatus] = useState(null); // 'loading' | 'ok' | 'error'
  const [captureMsg, setCaptureMsg]     = useState('');

  const isSubscribed = subscription?.status === 'active';

  const loadSites = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getUserSites(token);
      setSites(data.sites || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { loadSites(); }, [loadSites]);

  // Handle return from PayPal redirect (capture flow for subsequent sites)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isCapture = params.get('paypal_capture') === '1';
    const isCancelled = params.get('paypal_cancelled') === '1';

    if (isCancelled) {
      window.history.replaceState({}, '', '/account');
      return;
    }

    if (!isCapture) return;

    // PayPal redirects with ?token=ORDER_TOKEN in the URL (v2 Orders API)
    const paypalToken = params.get('token'); // PayPal's order token
    const storedOrderId = sessionStorage.getItem('paypal_order_id');
    window.history.replaceState({}, '', '/account');
    sessionStorage.removeItem('paypal_order_id');

    // Use the stored orderId (more reliable than PayPal's token param)
    const orderId = storedOrderId || paypalToken;
    if (!orderId) return;

    setCaptureStatus('loading');
    setCaptureMsg('Completing payment…');

    captureProRateOrder(token, orderId)
      .then(() => {
        setCaptureStatus('ok');
        setCaptureMsg('Site added successfully!');
        loadSites();
        onSubscriptionChange();
      })
      .catch(err => {
        setCaptureStatus('error');
        setCaptureMsg(err.message || 'Payment capture failed. Please contact support.');
      });
  }, [token, loadSites, onSubscriptionChange]);

  async function handleRemove(id) {
    if (!confirm('Remove this site from monitoring?')) return;
    try {
      await removeUserSite(token, id);
      setSites(prev => prev.filter(s => s.id !== id));
      onSubscriptionChange(); // refresh subscription card (site_count changes)
    } catch (err) {
      alert(err.message || 'Failed to remove site.');
    }
  }

  async function handleSaveEmails(id, emails) {
    await updateUserSiteEmails(token, id, emails);
    setSites(prev => prev.map(s => s.id === id ? { ...s, emails: JSON.stringify(emails) } : s));
  }

  function handleModalSuccess() {
    setShowModal(false);
    loadSites();
    onSubscriptionChange();
  }

  return (
    <div className="space-y-4">
      {/* Capture status banner */}
      {captureStatus === 'loading' && (
        <div className="card text-slate-600 text-sm">{captureMsg}</div>
      )}
      {captureStatus === 'ok' && (
        <div className="card border border-green-200 bg-green-50 text-green-800 text-sm flex items-center gap-2">
          <span>✓</span> {captureMsg}
        </div>
      )}
      {captureStatus === 'error' && (
        <div className="card border border-red-200 bg-red-50 text-red-700 text-sm">{captureMsg}</div>
      )}

      {/* Add site / subscribe card */}
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-semibold text-slate-800 mb-1">Monitor a website</h2>
            <p className="text-sm text-slate-500">
              {isSubscribed
                ? `Weekly scans · alerts to ${userEmail}`
                : 'Subscribe to start monitoring — weekly scans and email alerts.'}
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            disabled={subscription?.status === 'grace_period' || subscription?.status === 'suspended'}
            className="btn-primary text-sm whitespace-nowrap shrink-0"
            title={subscription?.status === 'grace_period' ? 'Resolve payment to add sites' : ''}
          >
            {isSubscribed ? 'Add site' : 'Subscribe & add site'}
          </button>
        </div>
        {!isSubscribed && (
          <p className="text-xs text-slate-400">
            <span className="line-through">$19</span> <strong>$9/month per site</strong> — cancel anytime.
          </p>
        )}
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
                    <tr key={site.id} className={`border-t border-slate-100 hover:bg-slate-50 ${site.paused ? 'opacity-60' : ''}`}>
                      <td className="px-5 py-3 font-mono text-xs text-slate-700 max-w-[160px] truncate" title={site.url}>
                        {site.base_domain}
                        {site.paused ? <span className="ml-1 text-amber-600 font-sans font-medium not-italic">(paused)</span> : null}
                      </td>
                      <td className="px-5 py-3 max-w-[260px]">
                        <EmailEditCell siteId={site.id} emails={emails} onSave={handleSaveEmails} />
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {site.paused
                          ? <span className="text-amber-600 font-medium text-xs">Paused</span>
                          : site.pending_scan_id
                            ? <span className="text-amber-600 font-medium text-xs">Scanning…</span>
                            : site.last_scan_status === 'success'
                              ? <span className="text-green-600 text-xs font-medium">OK</span>
                              : site.last_scan_status === 'failed'
                                ? <span className="text-red-500 text-xs font-medium" title={site.last_scan_error || ''}>Failed{site.last_scan_error ? ' ⓘ' : ''}</span>
                                : <span className="text-slate-400 text-xs">Never run</span>}
                      </td>
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap text-sm">
                        {site.paused || site.pending_scan_id ? '—' : formatDate(site.next_scan_at)}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {site.last_scan_id
                          ? <a href={`/report/${site.last_scan_id}`} className="text-brand-600 hover:underline text-sm">View report</a>
                          : <span className="text-slate-400 text-sm">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button onClick={() => handleRemove(site.id)}
                          className="text-xs text-red-500 hover:text-red-700 hover:underline">
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

      {/* Modals */}
      {showModal && !isSubscribed && (
        <SubscriptionModal
          token={token}
          userEmail={userEmail}
          onSuccess={handleModalSuccess}
          onClose={() => setShowModal(false)}
        />
      )}
      {showModal && isSubscribed && (
        <AddSiteModal
          token={token}
          userEmail={userEmail}
          onSuccess={handleModalSuccess}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ── Page root ──────────────────────────────────────────────────────────────

export default function Account() {
  const { user, logout, getAccessTokenSilently } = useAuth0();
  const [token, setToken]             = useState(null);
  const [tokenError, setTokenError]   = useState(false);
  const [subscription, setSubscription] = useState(undefined); // undefined = not loaded yet

  useEffect(() => {
    getAccessTokenSilently().then(setToken).catch(() => setTokenError(true));
  }, [getAccessTokenSilently]);

  const loadSubscription = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getSubscription(token);
      setSubscription(data.subscription);
    } catch {
      setSubscription(null);
    }
  }, [token]);

  useEffect(() => { loadSubscription(); }, [loadSubscription]);

  async function handleCancelSubscription() {
    await cancelSubscription(token);
    await loadSubscription();
  }

  function handleLogout() {
    logout({ logoutParams: { returnTo: window.location.origin } });
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header onLogout={handleLogout} />
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 space-y-6">

        {user && <ProfileCard user={user} />}

        {/* Subscription status card */}
        {token && subscription !== undefined && (
          <SubscriptionCard
            subscription={subscription}
            onCancel={handleCancelSubscription}
          />
        )}

        {tokenError ? (
          <div className="card text-red-600 text-sm">
            Could not load your session. Please sign out and sign in again.
          </div>
        ) : token && subscription !== undefined ? (
          <SitesSection
            token={token}
            userEmail={user?.email || ''}
            subscription={subscription}
            onSubscriptionChange={loadSubscription}
          />
        ) : (
          <div className="card text-center text-slate-400 text-sm py-8">Loading…</div>
        )}

      </main>
    </div>
  );
}
