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

export function severityLabel(severity) {
  if (severity === 'critical') return 'Critical';
  if (severity === 'important') return 'Important';
  return 'Minor';
}

export function severityBadgeClass(severity) {
  if (severity === 'critical') return 'badge-critical';
  if (severity === 'important') return 'badge-important';
  return 'badge-minor';
}

export function severityBorderClass(severity) {
  if (severity === 'critical') return 'border-l-red-400';
  if (severity === 'important') return 'border-l-amber-400';
  return 'border-l-slate-300';
}

export function gradeDescription(grade) {
  const map = { A: 'Excellent', B: 'Good', C: 'Needs attention', D: 'Poor', F: 'Critical issues' };
  return map[grade] || '';
}
