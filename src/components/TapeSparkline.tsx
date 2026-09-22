"use client";

import { useMemo } from "react";
import type { CatalogTradeRow } from "@/lib/types";
import { Panel } from "./Panel";

export type SparkPoint = {
  t: number;
  /** Implied YES probability 0–1 derived from tape row */
  yesProb: number;
  source: "ratio" | "nudge" | "spot";
};

/**
 * Derive a YES probability series from trade tape.
 * Prefer yesAmount/(yes+no). Soft side+size nudge only when it stays near spot.
 * Never invent OHLC — return empty if fewer than 2 timed points.
 */
export function deriveTapeSeries(
  items: CatalogTradeRow[],
  spotYes?: number | null,
): SparkPoint[] {
  const points: SparkPoint[] = [];
  const spot =
    spotYes != null && Number.isFinite(spotYes)
      ? Math.max(0.02, Math.min(0.98, spotYes))
      : null;

  for (const t of items) {
    const bt = t.blockTime;
    if (bt == null || !Number.isFinite(Number(bt))) continue;
    const time = Number(bt);

    let yesProb: number | null = null;
    let source: SparkPoint["source"] = "ratio";
    const y = Number(t.yesAmount ?? NaN);
    const n = Number(t.noAmount ?? NaN);
    if (Number.isFinite(y) && Number.isFinite(n) && y + n > 0) {
      // Flow mix ≠ market price — only keep when near spot (or no spot yet)
      const mix = y / (y + n);
      if (spot != null && Math.abs(mix - spot) > 0.3) {
        yesProb = null;
      } else {
        yesProb = mix;
        source = "ratio";
      }
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
        source = "nudge";
        // Honesty: if spot is ~balanced (or known) and nudge diverges wildly, drop nudge
        if (spot != null && yesProb != null) {
          if (Math.abs(yesProb - spot) > 0.28) {
            yesProb = null;
          }
        } else if (yesProb != null && Math.abs(yesProb - 0.5) > 0.35) {
          // No spot — still avoid painting 85–98% from weak heuristics alone
          yesProb = null;
        }
      }
    }

    if (yesProb == null || !Number.isFinite(yesProb)) continue;
    points.push({
      t: time,
      yesProb: Math.max(0.02, Math.min(0.98, yesProb)),
      source,
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
  /** When spot is known, keep axis honest around it instead of zooming to 98% */
  axisSpot?: number | null,
): { line: string; area: string; lastX: number; lastY: number } {
  const minT = series[0].t;
  const maxT = series[series.length - 1].t;
  const spanT = Math.max(1, maxT - minT);
  const ys = series.map((p) => p.yesProb);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  if (axisSpot != null && Number.isFinite(axisSpot)) {
    // Expand axis to include spot so a 50/50 market isn't framed as 98%
    minY = Math.min(minY, axisSpot);
    maxY = Math.max(maxY, axisSpot);
    // Prefer a readable band around spot when series is flat/extreme vs spot
    if (Math.abs(maxY - minY) < 0.08) {
      minY = Math.max(0, axisSpot - 0.12);
      maxY = Math.min(1, axisSpot + 0.12);
    }
  } else if (maxY - minY < 0.02) {
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
  spotYes,
}: {
  items: CatalogTradeRow[];
  busy?: boolean;
  /** Live detail YES price 0–1 — used to gate wild tape heuristics */
  spotYes?: number | null;
}) {
  const series = useMemo(
    () => deriveTapeSeries(items, spotYes),
    [items, spotYes],
  );
  const enough = series.length >= 2;
  const timedCount = useMemo(
    () => items.filter((t) => t.blockTime != null && Number.isFinite(Number(t.blockTime))).length,
    [items],
  );
  const printLabel =
    enough
      ? timedCount > series.length
        ? `${series.length}/${timedCount} prints`
        : `${series.length} prints`
      : "";
  const usedNudge = series.some((p) => p.source === "nudge");
  const w = 320;
  const h = 72;

  const path = useMemo(
    () => (enough ? buildPath(series, w, h, 4, spotYes) : null),
    [enough, series, spotYes],
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
      title="Tape-implied"
      action={
        enough ? (
          <span
            className={`mr-3.5 font-num text-[11px] ${
              up ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {up ? "+" : ""}
            {(delta * 100).toFixed(1)}¢ · {printLabel}
          </span>
        ) : null
      }
    >
      {busy && items.length === 0 ? (
        <div className="skeleton h-[72px] w-full" />
      ) : !enough ? (
        <div className="flex h-[72px] flex-col items-center justify-center rounded-md border border-dashed border-[#1f1f23] bg-[#0a0a0b]/60 px-3 text-center">
          <div className="type-body text-zinc-400">No tape series yet</div>
          <p className="type-meta mt-0.5">
            Needs ≥2 timed prints with size — no invented OHLC
            {items.length > 0 && timedCount < 2
              ? ` · ${items.length} tape row${items.length === 1 ? "" : "s"} lack timestamps`
              : ""}
          </p>
        </div>
      ) : path ? (
        <div className="relative">
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="h-[72px] w-full"
            role="img"
            aria-label="Tape-implied YES probability"
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
              {usedNudge ? " · soft" : ""}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-zinc-600">
            Tape-implied series{spotYes != null ? " · anchored to spot axis" : ""} · not OHLC
          </p>
        </div>
      ) : null}
    </Panel>
  );
}
