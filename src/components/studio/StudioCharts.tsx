"use client";

/**
 * Inline-SVG charts for Creator Studio (no chart library). Every chart has
 * an accessible label summarising its data and a visually hidden table, and
 * renders only real data: callers pass an empty/unavailable state instead of
 * zero-filled placeholders.
 */

import type { ReactNode } from "react";

export function ChartFrame({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <figure className="rounded-xl border border-line bg-inset/40 p-3">
      <figcaption className="mb-2">
        <p className="text-[12px] font-semibold text-ink">{title}</p>
        {description ? <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{description}</p> : null}
      </figcaption>
      {children}
      {footer ? <div className="mt-2 text-[11px] text-ink-3">{footer}</div> : null}
    </figure>
  );
}

export function ChartState({ kind, children }: { kind: "empty" | "sparse" | "unavailable" | "error"; children: ReactNode }) {
  const tone = kind === "error" ? "border-rose-400/30 text-rose-100/90" : kind === "unavailable" ? "border-amber-400/30 text-amber-100/90" : "border-line text-ink-3";
  return (
    <p role={kind === "error" ? "alert" : undefined} className={`rounded-lg border border-dashed px-3 py-4 text-center text-[12px] leading-relaxed ${tone}`}>
      {children}
    </p>
  );
}

const shortDay = (d: string) => `${Number(d.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(d.slice(5, 7)) - 1]}`;

/** Vertical bars per UTC day; one or more stacked-side-by-side series. */
export function DailyBars({
  days,
  series,
  label,
}: {
  days: string[];
  series: { name: string; className: string; values: number[] }[];
  label: string;
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const w = 300;
  const h = 90;
  const slot = w / Math.max(1, days.length);
  const bw = Math.max(1, (slot - 1.5) / series.length);
  const summary = series.map((s) => `${s.name}: ${s.values.reduce((a, b) => a + b, 0)} total`).join("; ");
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h + 2}`} className="h-28 w-full" preserveAspectRatio="none" role="img" aria-label={`${label}, ${days.length} UTC days from ${days[0]} to ${days[days.length - 1]}. ${summary}.`}>
        <rect x="0" y={h} width={w} height="1" className="fill-white/10" />
        {series.map((s, si) =>
          s.values.map((v, i) => {
            const bh = v > 0 ? Math.max(2, (v / max) * (h - 4)) : 0;
            return <rect key={`${si}-${i}`} x={i * slot + si * bw + 0.75} y={h - bh} width={bw} height={bh} rx="1" className={s.className} />;
          }),
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-3" aria-hidden="true">
        <span>{shortDay(days[0])}</span>
        <span>{shortDay(days[days.length - 1])}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-ink-3" aria-hidden="true">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden="true">
              <rect width="10" height="10" rx="2" className={s.className} />
            </svg>
            {s.name} <span className="font-num text-ink-2">{s.values.reduce((a, b) => a + b, 0)}</span>
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>UTC day</th>
            {series.map((s) => (
              <th key={s.name}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d, i) => (
            <tr key={d}>
              <td>{d}</td>
              {series.map((s) => (
                <td key={s.name}>{s.values[i]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal bars (room comparison, sources). Values are labelled in text, not by colour. */
export function HBars({ rows, label, unit }: { rows: { key: string; label: string; value: number; href?: string }[]; label: string; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="text-[12px]">
          <div className="flex items-baseline justify-between gap-2">
            {r.href ? (
              <a href={r.href} className="min-w-0 truncate text-ink-2 hover:text-ink hover:underline">
                {r.label}
              </a>
            ) : (
              <span className="min-w-0 truncate text-ink-2">{r.label}</span>
            )}
            <span className="shrink-0 font-num text-ink">
              {r.value} <span className="text-ink-3">{unit}</span>
            </span>
          </div>
          <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="mt-1 h-1.5 w-full" aria-hidden="true">
            <rect width="100" height="4" rx="2" className="fill-white/[0.06]" />
            <rect width={(r.value / max) * 100} height="4" rx="2" className="fill-cyan-400/80" />
          </svg>
        </li>
      ))}
    </ul>
  );
}

/** Ten-bucket forecast distribution (0–10 % … 90–100 % YES). */
export function ForecastDistribution({ buckets, meanBps }: { buckets: number[]; meanBps: number | null }) {
  const total = buckets.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...buckets);
  const label = `Distribution of ${total} current forecast${total === 1 ? "" : "s"} by YES probability. ${buckets.map((n, i) => `${i * 10}–${i * 10 + 10}%: ${n}`).join(", ")}.${meanBps !== null ? ` Mean ${(meanBps / 100).toFixed(1)}% YES.` : ""}`;
  return (
    <div>
      <svg viewBox="0 0 100 54" preserveAspectRatio="none" className="h-24 w-full" role="img" aria-label={label}>
        {buckets.map((n, i) => {
          const bh = n > 0 ? Math.max(2, (n / max) * 50) : 0;
          return <rect key={i} x={i * 10 + 1} y={52 - bh} width="8" height={bh} rx="1" className="fill-violet-400/80" />;
        })}
        {meanBps !== null ? <rect x={Math.min(99.5, meanBps / 100)} y="0" width="0.6" height="52" className="fill-cyan-300" /> : null}
        <rect x="0" y="52" width="100" height="1" className="fill-white/10" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-3" aria-hidden="true">
        <span>0% YES</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </div>
  );
}
