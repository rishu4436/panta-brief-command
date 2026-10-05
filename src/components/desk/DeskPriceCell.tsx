"use client";

import { deskPriceDisplay, type DeskPriceDisplay } from "@/lib/format";
import { PROBABILITY_UNAVAILABLE_TEXT, rawPriceNote } from "@/lib/panta/prices";
import type { PriceFields } from "@/lib/panta/prices";
import { ProbBar } from "../ProbBar";

function SecondaryPriceInline({ d, size = "sm" }: { d: Extract<DeskPriceDisplay, { mode: "secondary" }>; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "text-[11px]" : "text-[12px]";
  return (
    <div className={`${cls} font-num leading-tight`} title="Last observed YES/NO secondary prices · independent per side · not probabilities">
      <div>
        <span className="text-emerald-300">YES</span>{" "}
        <span className="text-ink-2">{d.yesLabel.replace(" USDC", "")}</span>
      </div>
      <div>
        <span className="text-rose-300">NO</span>{" "}
        <span className="text-ink-2">{d.noLabel.replace(" USDC", "")}</span>
      </div>
      <div className="text-[9px] text-ink-3">Last obs · USDC/sh</div>
    </div>
  );
}

/** Shared price cell: probability bar for primary; last-observed USDC for secondary. */
export function DeskPriceCell({
  market,
  size = "sm",
  showLabels = true,
}: {
  market: PriceFields;
  size?: "sm" | "md";
  showLabels?: boolean;
}) {
  const d = deskPriceDisplay(market);
  if (d.mode === "secondary") return <SecondaryPriceInline d={d} size={size} />;
  if (d.mode === "unavailable") {
    const label = d.secondaryHint ? "No secondary price" : PROBABILITY_UNAVAILABLE_TEXT[d.unavailable].short;
    return (
      <span
        className="text-[11px] text-amber-200/90"
        title={`${d.secondaryHint ? "No last-observed secondary price on either side." : PROBABILITY_UNAVAILABLE_TEXT[d.unavailable].long} ${rawPriceNote(d.probability)}`}
      >
        {label}
      </span>
    );
  }
  return (
    <ProbBar
      yes={d.yes}
      no={d.no}
      unavailable={null}
      note={rawPriceNote(d.probability)}
      size={size}
      showLabels={showLabels}
    />
  );
}

/** Compact sidebar labels (51% / 49% → YES 0.51 · NO 0.49 for secondary). */
export function deskSideLabels(market: PriceFields): { yesLabel: string; noLabel: string; title?: string } {
  const d = deskPriceDisplay(market);
  if (d.mode === "secondary") {
    const y = d.yes == null ? "—" : d.yes.toFixed(2);
    const n = d.no == null ? "—" : d.no.toFixed(2);
    return {
      yesLabel: y,
      noLabel: n,
      title: "Last observed YES/NO secondary prices (USDC/share) · not probabilities",
    };
  }
  if (d.mode === "unavailable") {
    return { yesLabel: "—", noLabel: "—", title: d.secondaryHint ? "No secondary price" : PROBABILITY_UNAVAILABLE_TEXT[d.unavailable].short };
  }
  const pct = (s: string) => `${(Number(s) * 100).toFixed(0)}%`;
  return { yesLabel: pct(d.yes), noLabel: pct(d.no) };
}
