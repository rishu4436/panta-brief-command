"use client";

import { useMemo } from "react";
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

export function TapeSparkline({ items, busy }: { items: Trade[]; busy?: boolean }) {
  const series = useMemo(() => deriveTapeSeries(items), [items]);
  const enough = series.length >= 2;
  const w = 320;
  const h = 72;
  const path = useMemo(() => (enough ? buildPath(series, w, h, 4) : null), [enough, series]);
  const first = enough ? series[0].yesProb : 0;
  const last = enough ? series[series.length - 1].yesProb : 0;
  const delta = last - first;

  return (
    <Panel
      title="Cumulative flow"
      action={
        enough ? (
          <span className="mr-3.5 font-num text-[11px] text-zinc-400">
            YES {(last * 100).toFixed(1)}% · {series.length} prints
          </span>
        ) : null
      }
    >
      {busy && items.length === 0 ? (
        <div className="skeleton h-[72px] w-full" />
      ) : !enough || !path ? (
        <div className="flex h-[72px] flex-col items-center justify-center rounded-md border border-dashed border-[#1f1f23] bg-[#0a0a0b]/60 px-3 text-center">
          <div className="type-body text-zinc-400">No flow series yet</div>
          <p className="type-meta mt-0.5">Needs ≥2 timed prints with a side · nothing invented</p>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="h-[72px] w-full"
            role="img"
            aria-label="Cumulative YES share of flow across the tape window"
          >
            <line x1="4" x2={w - 4} y1={h / 2} y2={h / 2} stroke="#2a2a2e" strokeDasharray="3 3" />
            <path d={path.area} fill="rgba(34,211,238,0.10)" />
            <path
              d={path.line}
              fill="none"
              stroke="#22d3ee"
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <circle cx={path.lastX} cy={path.lastY} r="2.5" fill="#22d3ee" />
          </svg>
          <div className="mt-1 flex justify-between font-num text-[10px] text-zinc-500">
            <span>first print {(first * 100).toFixed(0)}% YES</span>
            <span>
              now {(last * 100).toFixed(1)}% YES ({delta >= 0 ? "+" : ""}
              {(delta * 100).toFixed(1)} pts)
            </span>
          </div>
          <p className="mt-1 text-[10px] text-zinc-600">
            Running YES share of {series[0].basis === "shares" ? "shares" : "prints"} · flow, not price · 50% line dashed
          </p>
        </div>
      )}
    </Panel>
  );
}
