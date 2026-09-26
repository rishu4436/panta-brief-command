"use client";

import Link from "next/link";
import { useIsFetching } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { needsDetail, useBrief, useCatalog, useHydratedDetails } from "@/lib/data/hooks";
import { mergeMarket } from "@/lib/panta/markets";
import type { Market } from "@/lib/panta/domain";
import { catalogVolume, hasSpotPrice, impliedSide, isUntitledMarket, marketActivityRank, marketLabel, shouldShowCategoryChip } from "@/lib/format";
import { SectionHeader } from "../ui/SectionHeader";
import { StatusBadge, phaseTone } from "../ui/StatusBadge";
import { EmptyState, ErrorState, Skeleton, SkeletonLoader } from "../ui/States";
import { IconArrowRight, IconSparkles } from "../ui/Icons";
import { EvidenceTag } from "../brief/EvidenceTag";

type Filter = "volume" | "ending" | "resolved";
const isOpen = (m: Market) => marketActivityRank(m) <= 1;
const isResolved = (m: Market) => marketActivityRank(m) === 3;
const CANDIDATES = 8;
const SHOWN = 6;

function pct(p: string | null) {
  if (!hasSpotPrice(p)) return null;
  return Math.round(Number(p) * 100);
}

function fmtDate(ts?: number | null) {
  if (!ts) return null;
  return new Date(ts * 1000).toLocaleDateString("en-IN", { timeZone: "Asia/Calcutta", day: "numeric", month: "short", year: "numeric" });
}

function fmtVol(m: Market) {
  const v = catalogVolume(m);
  if (v == null || v <= 0) return null;
  return `${v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 0 : 2 })} USDC`;
}

function useInView<T extends Element>(margin = "200px 0px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin, seen]);
  return { ref, seen };
}

/** Pull one `### Section` body out of the brief narrative. */
function section(narrative: string, name: string) {
  const re = new RegExp(`###\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n###\\s|$)`, "i");
  const m = narrative.match(re);
  return m ? m[1].trim().replace(/\*\*/g, "") : "";
}

const ROW_GRID =
  "md:grid md:grid-cols-[minmax(0,1fr)_64px_64px_112px_76px] md:items-center md:gap-4 xl:grid-cols-[minmax(0,1fr)_112px_64px_64px_120px_112px_76px]";

function TableHead() {
  return (
    <div className={`hidden border-b border-line px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3 ${ROW_GRID}`} aria-hidden="true">
      <span>Market</span>
      <span className="hidden xl:block">Status</span>
      <span className="text-right">YES</span>
      <span className="text-right">NO</span>
      <span className="text-right">Volume</span>
      <span className="hidden xl:block">Ends</span>
      <span />
    </div>
  );
}

function MarketRow({ m, selected, onSelect }: { m: Market; selected: boolean; onSelect: () => void }) {
  const { yes, no } = impliedSide(m);
  const y = pct(yes);
  const n = pct(no) ?? (y != null ? 100 - y : null);
  const phase = phaseTone(m.phase || m.status);
  const vol = fmtVol(m);
  const end = fmtDate(m.endTime);
  const settled = marketActivityRank(m) === 3;
  const badge = (
    <StatusBadge tone={phase.tone} size="xs">
      {phase.label}
    </StatusBadge>
  );
  return (
    <li
      className={`relative rounded-lg px-4 py-3 transition-colors ${ROW_GRID} ${
        selected ? "bg-cyan-400/[0.07] ring-1 ring-inset ring-cyan-400/45" : "hover:bg-white/[0.025]"
      }`}
    >
      {selected ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-cyan-400" aria-hidden="true" /> : null}
      <div className="min-w-0">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="text-left after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:outline-none"
        >
          <span className={`line-clamp-2 text-[14px] font-semibold leading-snug ${selected ? "text-ink" : "text-ink-2"}`}>{marketLabel(m)}</span>
        </button>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-3">
          {selected ? <span className="text-[11px] font-semibold uppercase tracking-wider text-cyan-300">Selected</span> : null}
          <span className="xl:hidden">{badge}</span>
          {shouldShowCategoryChip(m.category, m.title, m.description) ? <span className="capitalize">{m.category}</span> : null}
          {end ? (
            <span className="xl:hidden">
              {settled ? "Ended" : "Ends"} <span className="font-num text-ink-2">{end}</span>
            </span>
          ) : null}
          {vol ? (
            <span className="md:hidden">
              Vol <span className="font-num text-ink-2">{vol}</span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="hidden xl:block">{badge}</div>
      {/* YES / NO: side by side on mobile, own columns from md */}
      <div className="mt-2.5 flex items-center gap-2 md:contents">
        <span className="font-num inline-flex min-w-16 items-baseline justify-end gap-1 rounded-md bg-emerald-400/[0.08] px-2 py-1 text-[15px] font-semibold text-emerald-200 md:bg-transparent md:px-0">
          <span className="text-[10px] font-semibold tracking-wider text-emerald-300 md:hidden">YES</span>
          {y != null ? `${y}¢` : "—"}
        </span>
        <span className="font-num inline-flex min-w-16 items-baseline justify-end gap-1 rounded-md bg-rose-400/[0.08] px-2 py-1 text-[15px] font-semibold text-rose-200 md:bg-transparent md:px-0">
          <span className="text-[10px] font-semibold tracking-wider text-rose-300 md:hidden">NO</span>
          {n != null ? `${n}¢` : "—"}
        </span>
        <span className="font-num hidden text-right text-[13px] text-ink-2 md:block">{vol ?? "—"}</span>
        <span className="font-num hidden text-[13px] text-ink-2 xl:block">{end ?? "—"}</span>
        <Link
          href={`/markets/${m.marketId}`}
          className="relative z-10 ml-auto inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2 text-[13px] font-medium text-cyan-300 hover:bg-cyan-400/10 hover:text-cyan-200 md:justify-self-end"
        >
          Open <IconArrowRight className="h-3.5 w-3.5" />
          <span className="sr-only">market: {marketLabel(m)}</span>
        </Link>
      </div>
    </li>
  );
}

function BriefPreview({ market, enabled, loading }: { market: Market | null; enabled: boolean; loading: boolean }) {
  const id = market?.marketId ?? "";
  const q = useBrief(id, "desk", 0, enabled && Boolean(id));
  const b = q.data && q.data.market.marketId === id ? q.data : null;
  const s = b?.signals;
  const obs = b ? section(b.narrative, "Observation") : "";
  const yes = s?.probability.yes;
  const flow = s?.flow.yesFlowShare;

  return (
    <aside className="flex h-full flex-col rounded-xl border border-line/70 bg-bg/40 p-4" aria-live="polite" aria-label="Brief for the selected market">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
          <IconSparkles className="h-3.5 w-3.5 text-violet-300" /> Brief · selected market
        </p>
        {b ? (
          <StatusBadge tone={b.source === "openai" ? "ai" : "neutral"} size="xs" title="Brief source">
            {b.source === "openai" ? "LLM" : "Template"}
          </StatusBadge>
        ) : null}
      </div>
      {!market && !loading ? (
        <p className="mt-3 text-[13px] text-ink-3">Select a market to see its brief.</p>
      ) : q.isError ? (
        <ErrorState
          className="mt-3"
          title="Brief unavailable right now"
          description="Market data is still available on the desk. The brief service may be rate limited; try again in a moment."
          onRetry={() => q.refetch()}
        />
      ) : !b ? (
        <div className="mt-3 space-y-2.5" role="status" aria-label="Loading brief">
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-10" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ) : (
        <>
          {b.market.partial ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-[12px] text-amber-200">
              <span>Panta returned a partial record, so some fields are missing.</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => q.refetch()} disabled={q.isFetching}>
                {q.isFetching ? "Retrying…" : "Retry brief"}
              </button>
            </div>
          ) : null}
          <dl className="mt-3 grid grid-cols-3 divide-x divide-line rounded-lg border border-line text-center">
            {(
              [
                ["Market YES", yes != null ? `${Math.round(yes * 100)}%` : "—"],
                ["Flow YES", flow != null ? `${Math.round(flow * 100)}%` : "—"],
                ["Quality", s?.dataQuality.grade ?? "—"],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="px-2 py-1.5">
                <dt className="text-[10px] uppercase tracking-wider text-ink-3">{k}</dt>
                <dd className="font-num text-[14px] font-semibold capitalize text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-3">
            <EvidenceTag layer="derived" className="mt-0.5 shrink-0" />
            <span className="line-clamp-3">{s?.headline}</span>
          </p>
          {obs ? (
            <p className="mt-2 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-3">
              <EvidenceTag layer="interpretation" className="mt-0.5 shrink-0" />
              <span className="line-clamp-4">{obs}</span>
            </p>
          ) : null}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 pt-2 text-[11px] text-ink-3">
            <span>
              {new Date(b.generatedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Calcutta", hour: "2-digit", minute: "2-digit" })} IST · not advice
            </span>
            <Link href={`/markets/${b.market.marketId}#brief`} className="inline-flex min-h-11 items-center gap-1 font-medium text-violet-300 hover:text-violet-200">
              Full brief <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </>
      )}
    </aside>
  );
}

export function MarketShowcase() {
  const { ref, seen } = useInView<HTMLElement>();
  const catalog = useCatalog({});
  const [filter, setFilter] = useState<Filter>("volume");
  const [picked, setPicked] = useState<string | null>(null);

  const candidates = useMemo(
    () =>
      filter === "resolved"
        ? catalog.items
            .filter(isResolved)
            .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0))
            .slice(0, CANDIDATES)
        : catalog.items
            .filter(isOpen)
            .sort((a, b) => (catalogVolume(b) ?? 0) - (catalogVolume(a) ?? 0))
            .slice(0, CANDIDATES),
    [catalog.items, filter],
  );
  const visible = useMemo(() => new Set(seen ? candidates.map((m) => m.marketId) : []), [candidates, seen]);
  const details = useHydratedDetails(candidates, visible);

  const markets = useMemo(() => {
    const merged = candidates
      .map((m) => mergeMarket(m, details.get(m.marketId)))
      // Re-check phase on the merged record: the detail can be fresher than the catalog row.
      .filter((m) => (filter === "resolved" ? isResolved(m) : isOpen(m)))
      .filter((m) => !isUntitledMarket(m) && hasSpotPrice(impliedSide(m).yes ?? impliedSide(m).no));
    const sorted =
      filter === "volume"
        ? merged.sort((a, b) => (catalogVolume(b) ?? 0) - (catalogVolume(a) ?? 0))
        : filter === "ending"
          ? merged
              .filter((m) => Boolean(m.endTime))
              .sort((a, b) => (a.endTime ?? Infinity) - (b.endTime ?? Infinity))
          : merged;
    return sorted.slice(0, SHOWN);
  }, [candidates, details, filter]);

  const selectedId = picked && markets.some((m) => m.marketId === picked) ? picked : (markets[0]?.marketId ?? null);
  const selected = markets.find((m) => m.marketId === selectedId) ?? null;
  const fetchingDetails = useIsFetching({ queryKey: ["market"] }) > 0;
  const hydratingMore = fetchingDetails && candidates.some((m) => needsDetail(m) && !details.has(m.marketId));
  const hydrating = candidates.length > 0 && markets.length === 0 && hydratingMore;

  return (
    <section ref={ref} id="live-markets" className="scroll-mt-20 border-y border-line bg-surface/40 py-14 sm:py-16" aria-labelledby="markets-title">
      <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
        <SectionHeader
          eyebrow="Live markets"
          id="markets-title"
          title="Markets worth watching."
          description="The only live section on this page: open Panta markets, priced now. Select a row for its brief."
          action={
            <Link href="/desk" className="btn btn-secondary">
              Explore All Markets <IconArrowRight className="h-4 w-4" />
            </Link>
          }
        />

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="segmented max-w-full flex-wrap" role="group" aria-label="Filter markets">
            {(
              [
                ["volume", "Top volume"],
                ["ending", "Ending soon"],
                ["resolved", "Recently resolved"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" className="whitespace-nowrap" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          <p className="flex items-center gap-2 text-[12px] text-ink-3">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-cyan-400" aria-hidden="true" />
            Live from the Panta API · {filter === "resolved" ? "settled markets" : "open markets"}
          </p>
        </div>

        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            {catalog.isError ? (
              <ErrorState
                title="Couldn't load markets"
                description="The Panta market feed didn't respond. Check your connection and try again."
                onRetry={() => catalog.refetch()}
              />
            ) : catalog.isPending || hydrating || !seen ? (
              <SkeletonLoader rows={4} label="Loading live markets" />
            ) : markets.length === 0 ? (
              <EmptyState
                className="card"
                title={
                  filter === "resolved"
                    ? "No recently resolved markets with complete data"
                    : filter === "ending"
                      ? "No open markets with an end date"
                      : "No open, priced markets right now"
                }
                description="The catalog is live but nothing matches this view. The desk lists every market, including resolved ones."
                action={
                  <Link href="/desk" className="btn btn-secondary btn-sm">
                    Open the desk
                  </Link>
                }
              />
            ) : (
              <div>
                <TableHead />
                <ul className="mt-1 divide-y divide-line/60">
                  {markets.map((m) => (
                    <MarketRow key={m.marketId} m={m} selected={m.marketId === selectedId} onSelect={() => setPicked(m.marketId)} />
                  ))}
                </ul>
              </div>
            )}
            {markets.length > 0 && hydratingMore ? (
              <p className="mt-3 text-[12px] text-ink-3" role="status">
                Checking more markets…
              </p>
            ) : null}
            {filter !== "resolved" && markets.length > 0 && markets.length < 4 && !hydratingMore ? (
              <p className="mt-3 text-[12px] text-ink-3">
                Only {markets.length} open market{markets.length === 1 ? "" : "s"} in the latest catalog page {markets.length === 1 ? "has" : "have"} a title and a live price right now.
                The desk lists every market, including resolved ones.
              </p>
            ) : null}
          </div>
          <div className="min-w-0">
            <BriefPreview market={selected} enabled={seen} loading={catalog.isPending || hydrating || !seen} />
          </div>
        </div>
      </div>
    </section>
  );
}
