"use client";

import { useMemo } from "react";
import type { CatalogTradeRow } from "@/lib/types";
import { Panel } from "./Panel";

export type SparkPoint = {
  t: number;
  /** Implied YES probability 0–1 derived from tape row */
  yesProb: number;
};

/**
 * Derive a simple YES probability series from trade tape.
 * Prefer yesAmount/(yes+no); soft side+size signal otherwise.
 * Never invent OHLC — return empty if fewer than 2 timed points.
 */
export function deriveTapeSeries(items: CatalogTradeRow[]): SparkPoint[] {
  const points: SparkPoint[] = [];

  for (const t of items) {
    const bt = t.blockTime;
    if (bt == null || !Number.isFinite(Number(bt))) continue;
    const time = Number(bt);

    let yesProb: number | null = null;
    const y = Number(t.yesAmount ?? NaN);
    const n = Number(t.noAmount ?? NaN);
    if (Number.isFinite(y) && Number.isFinite(n) && y + n > 0) {
      yesProb = y / (y + n);
    } else {
      const side = (t.side || "").toLowerCase();
      const amt = Number(t.amountUsdc ?? NaN);
      if (side === "yes" || side === "no") {
        if (Number.isFinite(amt) && amt > 0) {
          const nudge = Math.min(amt, 500) / 2000;
          yesProb = side === "yes" ? Math.min(0.85, 0.5 + nudge) : Math.max(0.15, 0.5 - nudge);
        } else {
          yesProb = side === "yes" ? 0.55 : 0.45;
        }
      }
    }

    if (yesProb == null || !Number.isFinite(yesProb)) continue;
    points.push({
      t: time,
      yesProb: Math.max(0.02, Math.min(0.98, yesProb)),
    });
  }

  points.sort((a, b) => a.t - b.t);

  const collapsed: SparkPoint[] = [];
  for (const p of points) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.t === p.t) collapsed[collapsed.length - 1] = p;
    else collapsed.push(p);
  }
  return collapsed;
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
  const ys = series.map((p) => p.yesProb);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  if (maxY - minY < 0.02) {
    minY = Math.max(0, minY - 0.05);
    maxY = Math.min(1, maxY + 0.05);
  }
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

export function TapeSparkline({
  items,
  busy,
}: {
  items: CatalogTradeRow[];
  busy?: boolean;
}) {
  const series = useMemo(() => deriveTapeSeries(items), [items]);
  const enough = series.length >= 2;
  const w = 320;
  const h = 72;

  const path = useMemo(
    () => (enough ? buildPath(series, w, h) : null),
    [enough, series],
  );

  const delta =
    enough && series.length >= 2
      ? series[series.length - 1].yesProb - series[0].yesProb
      : 0;
  const up = delta >= 0;
  const stroke = up ? "#34d399" : "#fb7185";
  const fill = up ? "rgba(52,211,153,0.12)" : "rgba(251,113,133,0.12)";

  return (
    <Panel
      title="Tape sparkline"
      action={
        enough ? (
          <span
            className={`mr-3.5 font-num text-[11px] ${
              up ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {up ? "+" : ""}
            {(delta * 100).toFixed(1)}¢ · {series.length} prints
          </span>
        ) : null
      }
    >
      {busy && items.length === 0 ? (
        <div className="skeleton h-[72px] w-full" />
      ) : !enough ? (
        <div className="flex h-[72px] flex-col items-center justify-center rounded-md border border-dashed border-[#1f1f23] bg-[#0a0a0b]/60 px-3 text-center">
          <div className="text-[12px] text-zinc-400">No sparkline yet</div>
          <p className="mt-0.5 text-[10px] text-zinc-500">
            Needs ≥2 timed tape prints with size or side — no invented OHLC
          </p>
        </div>
      ) : path ? (
        <div className="relative">
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="h-[72px] w-full"
            role="img"
            aria-label="YES probability from trade tape"
          >
            <path d={path.area} fill={fill} />
            <path
              d={path.line}
              fill="none"
              stroke={stroke}
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <circle cx={path.lastX} cy={path.lastY} r="2.5" fill={stroke} />
          </svg>
          <div className="mt-1 flex justify-between font-num text-[10px] text-zinc-500">
            <span>start {(series[0].yesProb * 100).toFixed(1)}%</span>
            <span>
              last {(series[series.length - 1].yesProb * 100).toFixed(1)}% YES
            </span>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
