/** Per-market display scores (oldest → newest) on a 0–100 scale, with the 75 (always-50%) reference line. */
export function AccuracySparkline({ points, label }: { points: { scoreC: number; at: string }[]; label: string }) {
  const W = 320;
  const H = 72;
  const pad = 6;
  if (points.length === 0) return null;
  const x = (i: number) => (points.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (points.length - 1));
  const y = (c: number) => pad + ((10000 - c) * (H - 2 * pad)) / 10000;
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.scoreC).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[72px] w-full" role="img" aria-label={label} preserveAspectRatio="none">
      <line x1={pad} x2={W - pad} y1={y(7500)} y2={y(7500)} stroke="currentColor" strokeOpacity="0.18" strokeDasharray="3 4" />
      {points.length > 1 ? <path d={d} fill="none" stroke="rgb(34 211 238)" strokeWidth="1.75" vectorEffect="non-scaling-stroke" /> : null}
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.scoreC)} r="2.5" fill="rgb(34 211 238)">
          <title>{`${(p.scoreC / 100).toFixed(2)} · ${p.at.slice(0, 10)}`}</title>
        </circle>
      ))}
    </svg>
  );
}
