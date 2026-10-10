"use client";

import {
  formatMarkUsdc,
  LARGEST_UNAVAILABLE_NOTE,
  MARKS_LOADING_NOTE,
  PNL_UNAVAILABLE_NOTE,
  POSITIONS_VS_ACTIVITY_NOTE,
  type PortfolioIntel as PortfolioIntelData,
} from "@/lib/panta/position-intel";
import { exposureNote, exposureView, POSITIONS_STALE_NOTE, type PortfolioReadState } from "@/lib/panta/exposure-view";

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
  // All valid marks are $0 (e.g. only losing resolved positions): no split to show.
  // A 50/50 bar here would invent an exposure that doesn't exist.
  if (!(total > 0)) {
    return (
      <div className="mt-2">
        <div className="h-2 rounded-full bg-elevated" aria-hidden="true" />
        <p className="mt-1.5 text-[11px] text-ink-3">No open exposure · every valid mark is {formatMarkUsdc(0)}</p>
      </div>
    );
  }
  const yPct = (yes / total) * 100;
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

export function PortfolioIntelHeader({ intel, read }: { intel: PortfolioIntelData; read: PortfolioReadState }) {
  const view = exposureView(read, intel);
  const unread = view === "loading" || view === "read-failed";
  const markSub = unread
    ? exposureNote(view)
    : intel.marksPending
      ? MARKS_LOADING_NOTE
      : intel.hasPartialMarks
        ? `${intel.unavailableMarkCount} mark${intel.unavailableMarkCount === 1 ? "" : "s"} unavailable`
        : intel.noValidMarks && intel.positionCount > 0
          ? "No valid marks"
          : undefined;

  // Counts are only shown after a successful read: a failed read is not "0 positions".
  const count = (n: number) => (unread ? "—" : String(n));
  const markValue = view === "loading" || intel.marksPending
    ? "…"
    : view === "read-failed" || (intel.noValidMarks && view !== "empty")
      ? "—"
      : formatMarkUsdc(view === "empty" ? 0 : intel.totalValidMarked);

  return (
    <section aria-label="Portfolio overview" className="space-y-3">
      {read === "stale" ? (
        <p role="status" className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-[12px] text-amber-100/90">
          {POSITIONS_STALE_NOTE}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Positions" value={count(intel.positionCount)} />
        <Stat label="Marked value" value={markValue} sub={markSub} />
        <Stat label="Claimable" value={count(intel.claimableCount)} />
        <Stat
          label="Active"
          value={count(intel.activeCount)}
          sub={unread ? undefined : `${intel.secondaryCount} secondary · ${intel.resolvedCount} resolved`}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-inset/60 px-3 py-2.5">
          <p className="type-col text-[10px] tracking-[0.08em] text-ink-3">Exposure</p>
          {view === "valued" || view === "zero" ? (
            <Bar yes={intel.yesExposure} no={intel.noExposure} />
          ) : (
            <p className="mt-2 text-[12px] text-ink-3">{exposureNote(view)}</p>
          )}
        </div>
        <div className="rounded-xl border border-line bg-inset/60 px-3 py-2.5">
          <p className="type-col text-[10px] tracking-[0.08em] text-ink-3">Largest position</p>
          {view !== "valued" ? (
            <p className="mt-2 text-[12px] text-ink-3">{exposureNote(view)}</p>
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
