import type { ReactNode } from "react";

/** Amber pill on every composition that shows example data. */
export function Illustrative({ children = "Illustrative" }: { children?: ReactNode }) {
  return <span className="lv-illustrative">{children}</span>;
}

/** Mono section index: "03 — Prediction Rooms". */
export function Kicker({ index, children, className = "" }: { index: string; children: ReactNode; className?: string }) {
  return (
    <p className={`lv-kicker ${className}`}>
      <b>{index}</b>
      {children}
    </p>
  );
}

/** Small line chart from 0–1 values. Decorative; the caption carries meaning. */
export function Sparkline({
  values,
  width = 280,
  height = 72,
  stroke = "#12d6f5",
  fillId,
  className = "",
  baseline,
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fillId: string;
  className?: string;
  /** Optional dashed reference line (0–1), e.g. the market price. */
  baseline?: number;
}) {
  const min = Math.min(...values, baseline ?? 1) - 0.04;
  const max = Math.max(...values, baseline ?? 0) + 0.04;
  const y = (v: number) => height - ((v - min) / (max - min)) * height;
  const step = width / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${fillId})`} />
      {baseline != null && <line x1="0" x2={width} y1={y(baseline)} y2={y(baseline)} stroke="#a4b2c7" strokeOpacity="0.35" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Forecast distribution: ten buckets with optional market and consensus markers (0–100). */
export function Histogram({
  buckets,
  market,
  consensus,
  className = "",
  barClass = "h-20",
}: {
  buckets: number[];
  market?: number;
  consensus?: number;
  className?: string;
  barClass?: string;
}) {
  const max = Math.max(1, ...buckets);
  return (
    <div className={className} aria-hidden="true">
      <div className={`relative flex items-end gap-[3px] ${barClass}`}>
        {buckets.map((n, i) => (
          <span key={i} className={`flex-1 lv-bar ${n === 0 ? "lv-bar--muted" : ""}`} style={{ height: `${Math.max(4, (n / max) * 100)}%` }} />
        ))}
        {market != null && (
          <span className="absolute inset-y-[-6px] w-px bg-ink/70" style={{ left: `${market}%` }}>
            <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 bg-ink" />
          </span>
        )}
        {consensus != null && (
          <span className="absolute inset-y-[-6px] w-px border-l border-dashed border-emerald-300" style={{ left: `${consensus}%` }}>
            <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-emerald-300" />
          </span>
        )}
      </div>
      <div className="lv-mono mt-1.5 flex justify-between text-[9px] text-ink-3">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

/** Two-tone probability bar. */
export function ProbBar({ yes, className = "" }: { yes: number; className?: string }) {
  return (
    <div className={`flex h-1.5 overflow-hidden rounded-full bg-rose-400/30 ${className}`} aria-hidden="true">
      <span className="h-full rounded-full bg-emerald-400" style={{ width: `${yes}%` }} />
    </div>
  );
}

/** Mini window chrome for product panels. */
export function WindowDots() {
  return (
    <span className="flex gap-1.5" aria-hidden="true">
      <span className="h-2 w-2 rounded-full bg-ink-3/30" />
      <span className="h-2 w-2 rounded-full bg-ink-3/30" />
      <span className="h-2 w-2 rounded-full bg-ink-3/30" />
    </span>
  );
}

export function SectionShell({
  id,
  labelledBy,
  children,
  className = "",
}: {
  id?: string;
  labelledBy: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`relative scroll-mt-20 ${className}`}>
      {children}
    </section>
  );
}
