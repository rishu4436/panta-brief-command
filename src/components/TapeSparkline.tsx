"use client";

import { useMemo, useState } from "react";
import type { Trade } from "@/lib/panta/domain";
import { Panel } from "./Panel";

export type SparkPoint = {
  t: number;
  /** Cumulative YES share of flow (0–1) up to and including this print. */
  yesProb: number;
  basis: "shares" | "prints";
};

/**
 * Cumulative YES flow share across the tape window, oldest → newest.
 * Share-weighted when every sided print has a size, else print-weighted.
 * This is flow, not price: tape rows carry no per-trade price, so no price
 * series (or OHLC) is invented. Empty when fewer than 2 timed sided prints.
 */
export function deriveTapeSeries(items: Trade[]): SparkPoint[] {
  const rows = items
    .filter((t) => t.side && t.blockTime != null && Number.isFinite(t.blockTime))
    .sort((a, b) => (a.blockTime as number) - (b.blockTime as number));
  if (rows.length < 2) return [];
  const basis: SparkPoint["basis"] = rows.every((t) => t.shares != null) ? "shares" : "prints";
  let yes = 0;
  let total = 0;
  const out: SparkPoint[] = [];
  for (const t of rows) {
    const w = basis === "shares" ? (t.shares as number) : 1;
    total += w;
    if (t.side === "yes") yes += w;
    const point = { t: t.blockTime as number, yesProb: total > 0 ? yes / total : 0.5, basis };
    const last = out[out.length - 1];
    if (last && last.t === point.t) out[out.length - 1] = point;
    else out.push(point);
  }
  return out.length >= 2 ? out : [];
}

function buildPath(
  series: SparkPoint[],
  w: number,
  h: number,
  pad = 4,
): { line: string; area: string; lastX: number; lastY: number } {
  const minT = series[0].t;
  const maxT = series[series.length - 1].t;
  const spanT = Math.max(1, maxT - minT);
  // Fixed 0–100% axis: a share of flow, never zoomed to exaggerate moves.
  const minY = 0;
  const maxY = 1;
  const spanY = maxY - minY || 1;

  const coords = series.map((p) => {
    const x = pad + ((p.t - minT) / spanT) * (w - pad * 2);
    const y = pad + (1 - (p.yesProb - minY) / spanY) * (h - pad * 2);
    return { x, y };
  });

  const line = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const first = coords[0];
  const last = coords[coords.length - 1];
  const area = `${line} L${last.x.toFixed(1)},${h - pad} L${first.x.toFixed(1)},${h - pad} Z`;
  return { line, area, lastX: last.x, lastY: last.y };
}

const RANGES = [
  { id: "10", label: "Last 10", n: 10 },
  { id: "25", label: "Last 25", n: 25 },
  { id: "all", label: "All", n: Infinity },
] as const;

/**
 * Market activity chart: running YES share of flow over the tape window.
 * Range = how many of the most recent sided prints to include (the tape has
 * no per-trade price, so there is no price or time-range chart to offer).
 */
export function TapeSparkline({ items, busy, size = "md" }: { items: Trade[]; busy?: boolean; size?: "md" | "lg" }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("all");
  const sided = useMemo(
    () =>
      items
        .filter((t) => t.side && t.blockTime != null && Number.isFinite(t.blockTime))
        .sort((a, b) => (b.blockTime as number) - (a.blockTime as number)),
    [items],
  );
  const n = RANGES.find((r) => r.id === range)?.n ?? Infinity;
  const series = useMemo(() => deriveTapeSeries(Number.isFinite(n) ? sided.slice(0, n) : sided), [sided, n]);
  const enough = series.length >= 2;
  const w = 640;
  const h = size === "lg" ? 180 : 96;
  const pad = 6;
  const path = useMemo(() => (enough ? buildPath(series, w, h, pad) : null), [enough, series, h]);
  const first = enough ? series[0].yesProb : 0;
  const last = enough ? series[series.length - 1].yesProb : 0;
  const delta = last - first;
  const hCls = size === "lg" ? "h-[180px]" : "h-[96px]";

  return (
    <Panel
      title="Market activity"
      subtitle="Cumulative YES share of flow"
      action={
        sided.length >= 2 ? (
          <div className="segmented mr-3" role="group" aria-label="Prints included">
            {RANGES.map((r) => (
              <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)} disabled={Number.isFinite(r.n) && sided.length <= r.n && r.id !== "all"}>
                {r.label}
              </button>
            ))}
          </div>
        ) : null
      }
    >
      {busy && items.length === 0 ? (
        <div className={`skeleton w-full ${hCls}`} />
      ) : !enough || !path ? (
        <div className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-inset/60 px-3 text-center ${hCls}`}>
          <div className="text-[13px] font-medium text-ink-2">No flow series yet</div>
          <p className="type-meta mt-1">Needs at least 2 timed prints with a side. Nothing is invented.</p>
        </div>
      ) : (
        <div className="relative">
          <div className="flex items-baseline gap-3">
            <span className="font-num text-[22px] font-semibold text-ink">{(last * 100).toFixed(1)}%</span>
            <span className="text-[12px] text-ink-3">YES share of {series[0].basis}</span>
            <span className={`font-num text-[12px] ${delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
              {delta >= 0 ? "+" : ""}
              {(delta * 100).toFixed(1)} pts over {series.length} prints
            </span>
          </div>
          <div className="relative mt-2 pl-8">
            <div className="absolute inset-y-0 left-0 flex flex-col justify-between py-1 font-num text-[10px] text-ink-3" aria-hidden="true">
              <span>100%</span>
              <span>50%</span>
              <span>0%</span>
            </div>
            <svg
              viewBox={`0 0 ${w} ${h}`}
              preserveAspectRatio="none"
              className={`${hCls} w-full`}
              role="img"
              aria-label={`Cumulative YES share of flow: ${(first * 100).toFixed(0)}% at first print, ${(last * 100).toFixed(1)}% now, across ${series.length} prints`}
            >
              <defs>
                <linearGradient id="flow-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#12D6F5" stopOpacity="0.25" />
                  <stop offset="1" stopColor="#12D6F5" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1={pad} x2={w - pad} y1={pad} y2={pad} stroke="#1d2b42" />
              <line x1={pad} x2={w - pad} y1={h / 2} y2={h / 2} stroke="#2a3b57" strokeDasharray="4 4" />
              <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke="#1d2b42" />
              <path d={path.area} fill="url(#flow-fill)" />
              <path d={path.line} fill="none" stroke="#12D6F5" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <p className="mt-2 text-[11px] text-ink-3">
            Flow, not price: tape rows carry no per-trade price, so no price history is drawn. 50% line dashed.
          </p>
        </div>
      )}
    </Panel>
  );
}
