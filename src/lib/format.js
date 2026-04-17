export function scoreColor(score) {
  if (score >= 90) return 'text-green-600';
  if (score >= 70) return 'text-amber-500';
  if (score >= 50) return 'text-orange-500';
  return 'text-red-600';
}

export function scoreBgColor(score) {
  if (score >= 90) return 'bg-green-50 border-green-200';
  if (score >= 70) return 'bg-amber-50 border-amber-200';
  if (score >= 50) return 'bg-orange-50 border-orange-200';
  return 'bg-red-50 border-red-200';
}

export function severityBadgeClass(severity) {
  if (severity === 'critical') return 'badge-critical';
  if (severity === 'important') return 'badge-important';
  return 'badge-minor';
}

export function gradeDescription(grade) {
  const map = { A: 'Excellent', B: 'Good', C: 'Needs attention', D: 'Poor', F: 'Critical issues' };
  return map[grade] || '';
}

export function formatDate(unixTs) {
  if (!unixTs) return '—';
  return new Date(unixTs * 1000).toLocaleString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatDateShort(unixTs) {
  if (!unixTs) return '—';
  return new Date(unixTs * 1000).toLocaleDateString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export function shortUrl(url, maxLen = 60) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const full = u.hostname + u.pathname + u.search;
    return full.length > maxLen ? full.slice(0, maxLen) + '…' : full;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen) + '…' : url;
  }
}
