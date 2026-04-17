import { useState } from 'react';

export default function EmailEditCell({ siteId, emails, onSave }) {
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
