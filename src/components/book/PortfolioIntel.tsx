"use client";

import {
  formatMarkUsdc,
  LARGEST_UNAVAILABLE_NOTE,
  MARKS_LOADING_NOTE,
  PNL_UNAVAILABLE_NOTE,
  POSITIONS_VS_ACTIVITY_NOTE,
  type PortfolioIntel as PortfolioIntelData,
} from "@/lib/panta/position-intel";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-inset/60 px-3 py-2.5">
      <p className="type-col text-[10px] tracking-[0.08em] text-ink-3">{label}</p>
      <p className="font-num mt-1 truncate text-[18px] font-semibold text-ink">{value}</p>
      {sub ? <p className="mt-0.5 truncate text-[11px] text-ink-3">{sub}</p> : null}
    </div>
  );
}

function Bar({ yes, no }: { yes: number; no: number }) {
  const total = yes + no;
  const yPct = total > 0 ? (yes / total) * 100 : 50;
  return (
    <div className="mt-2">
      <div className="flex h-2 overflow-hidden rounded-full bg-elevated">
        <div className="bg-emerald-400/80 transition-[width]" style={{ width: `${yPct}%` }} />
        <div className="bg-rose-400/80 transition-[width]" style={{ width: `${100 - yPct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px]">
        <span className="font-num text-emerald-300">YES {formatMarkUsdc(yes)}</span>
        <span className="font-num text-rose-300">NO {formatMarkUsdc(no)}</span>
      </div>
    </div>
  );
}

export function PortfolioIntelHeader({ intel }: { intel: PortfolioIntelData }) {
  const markSub = intel.marksPending
    ? MARKS_LOADING_NOTE
    : intel.hasPartialMarks
      ? `${intel.unavailableMarkCount} mark${intel.unavailableMarkCount === 1 ? "" : "s"} unavailable`
      : intel.noValidMarks && intel.positionCount > 0
        ? "No valid marks"
        : undefined;

  const markValue = intel.marksPending
    ? "…"
    : intel.noValidMarks
      ? "—"
      : formatMarkUsdc(intel.totalValidMarked);

  return (
    <section aria-label="Portfolio overview" className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Positions" value={String(intel.positionCount)} />
        <Stat label="Marked value" value={markValue} sub={markSub} />
        <Stat label="Claimable" value={String(intel.claimableCount)} />
        <Stat
          label="Active"
          value={String(intel.activeCount)}
          sub={`${intel.secondaryCount} secondary · ${intel.resolvedCount} resolved`}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-inset/60 px-3 py-2.5">
          <p className="type-col text-[10px] tracking-[0.08em] text-ink-3">Exposure</p>
          {intel.marksPending ? (
            <p className="mt-2 text-[12px] text-ink-3">{MARKS_LOADING_NOTE}</p>
          ) : intel.noValidMarks ? (
            <p className="mt-2 text-[12px] text-ink-3">{LARGEST_UNAVAILABLE_NOTE}</p>
          ) : (
            <Bar yes={intel.yesExposure} no={intel.noExposure} />
          )}
        </div>
        <div className="rounded-xl border border-line bg-inset/60 px-3 py-2.5">
          <p className="type-col text-[10px] tracking-[0.08em] text-ink-3">Largest position</p>
          {intel.marksPending ? (
            <p className="mt-2 text-[12px] text-ink-3">{MARKS_LOADING_NOTE}</p>
          ) : intel.largest ? (
            <div className="mt-1.5">
              <p className="truncate text-[13px] font-medium text-ink" title={intel.largest.title}>
                {intel.largest.title}
              </p>
              <p className="font-num mt-0.5 text-[12px] text-ink-2">
                <span className={intel.largest.side === "yes" ? "text-emerald-300" : "text-rose-300"}>
                  {(intel.largest.side || "—").toUpperCase()}
                </span>
                {" · "}
                {intel.largest.shares} shares · {formatMarkUsdc(intel.largest.markedValue)}
                <span className="text-ink-3"> · {intel.largest.percentOfValid.toFixed(0)}% of book</span>
              </p>
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-ink-3">{LARGEST_UNAVAILABLE_NOTE}</p>
          )}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-3">{PNL_UNAVAILABLE_NOTE}</p>
      <p className="text-[11px] leading-relaxed text-ink-3">{POSITIONS_VS_ACTIVITY_NOTE}</p>
    </section>
  );
}
