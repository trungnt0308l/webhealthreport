/**
 * Inline SVG sparkline of health scores over time (0–100 scale).
 * Line and end-dot are coloured by the most recent score.
 */
export default function ScoreSparkline({ scans, width = 96, height = 28 }) {
  const scores = scans.map(s => s.healthScore);
  if (scores.length === 0) return null;

  const last = scores[scores.length - 1];
  const color = last >= 90 ? '#16a34a' : last >= 70 ? '#f59e0b' : last >= 50 ? '#f97316' : '#dc2626';

  const pad = 4;
  const y = s => height - pad - (s / 100) * (height - pad * 2);

  if (scores.length === 1) {
    return (
      <svg width={width} height={height} aria-label={`Health score ${last}`}>
        <circle cx={width / 2} cy={y(last)} r="3" fill={color} />
      </svg>
    );
  }

  const step = (width - pad * 2) / (scores.length - 1);
  const points = scores.map((s, i) => `${(pad + i * step).toFixed(1)},${y(s).toFixed(1)}`);

  return (
    <svg width={width} height={height} aria-label={`Health score trend, latest ${last}`}>
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={pad + (scores.length - 1) * step}
        cy={y(last)}
        r="2.5"
        fill={color}
      />
    </svg>
  );
}
