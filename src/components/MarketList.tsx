"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCatalog, useCategories, useHydratedDetails, useViewportIds } from "@/lib/data/hooks";
import { describeErr } from "@/lib/errors";
import {
  catalogVolume,
  formatVolumeUsdc,
  impliedSide,
  isUntitledMarket,
  marketLabel,
  marketSubtitle,
  shouldShowCategoryChip,
} from "@/lib/format";
import { notifyStorage, pushRecent } from "@/lib/storage";
import { mergeMarket } from "@/lib/panta/markets";
import type { Market } from "@/lib/types";
import { useRecents, useWatchlist } from "@/hooks/useLocalIds";
import { Panel } from "./Panel";
import { PhaseBadge } from "./PhaseBadge";
import { ProbBar } from "./ProbBar";
import { WatchStar } from "./WatchStar";
import { HotTapeRail } from "./HotTapeRail";

type ViewMode = "rows" | "cards";
type SortMode = "default" | "volume" | "ending" | "phase";

function formatEnd(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("en-IN", {
    timeZone: "Asia/Calcutta",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatUpdated(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Calcutta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function isApiKeyError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("api key") ||
    m.includes("panta_api_key") ||
    m.includes("unauthorized") ||
    m.includes("authentication") ||
    m.includes("401") ||
    m.includes("missing key") ||
    m.includes("x-api-key") ||
    m.includes("forbidden") ||
    m.includes("503") ||
    m.includes("proxy_unreachable")
  );
}

function volumeNum(m: Market): number {
  const v = catalogVolume(m);
  if (v == null) return 0;
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function hasHumanLabel(m: Market): boolean {
  return !isUntitledMarket(m);
}

function hasAnySpot(m: Market): boolean {
  const { yes, no } = impliedSide(m);
  if (yes !== null && yes !== undefined && yes !== "") {
    const n = typeof yes === "string" ? Number(yes) : yes;
    if (Number.isFinite(n)) return true;
  }
  if (no !== null && no !== undefined && no !== "") {
    const n = typeof no === "string" ? Number(no) : no;
    if (Number.isFinite(n)) return true;
  }
  return false;
}

function phaseMatches(m: Market, phase: string): boolean {
  if (!phase) return true;
  const want = phase.toLowerCase();
  const p = (m.phase || "").toLowerCase();
  const s = (m.status || "").toLowerCase();
  if (want === "primary") {
    // API status=primary often mixes cancelled/resolved — keep chip honest
    return p === "primary" || s === "primary" || s === "open";
  }
  if (want === "secondary") {
    return p === "secondary" || s === "secondary" || s === "secondary_active";
  }
  return p === want || s === want;
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-4 w-3/4 max-w-md" />
            <div className="skeleton h-3 w-40" />
          </div>
          <div className="skeleton h-5 w-16" />
          <div className="hidden w-24 space-y-1.5 sm:block">
            <div className="skeleton ml-auto h-5 w-16" />
            <div className="skeleton h-1.5 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SetupPanel({ error }: { error: string }) {
  const auth = isApiKeyError(error);
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center animate-fade-in">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-400 text-lg font-black text-bg">
        P
      </span>
      <h2 className="mt-4 text-lg font-semibold tracking-tight text-zinc-50">
        {auth ? "Connect Panta API" : "Desk unavailable"}
      </h2>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        {auth
          ? "Add your key to unlock the live market catalog."
          : "Live catalog could not load. Check the proxy and try again."}
      </p>
      {auth && (
        <code className="mt-4 rounded-md border border-line bg-inset px-3 py-2 font-num text-[12px] text-cyan-300">
          PANTA_API_KEY=pk_…
        </code>
      )}
      {auth && (
        <p className="mt-3 max-w-md text-[11px] text-zinc-600">
          Place it in <span className="text-zinc-400">.env.local</span> and restart
          the dev server.
        </p>
      )}
      {!auth && (
        <p className="mt-4 max-w-lg text-[10px] text-zinc-600">
          {error.length > 120 ? `${error.slice(0, 120)}…` : error}
        </p>
      )}
      <a
        href="https://docs.panta.market/"
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-flex items-center rounded-md bg-cyan-400 px-4 py-2 text-sm font-semibold text-bg transition hover:bg-cyan-300 active:scale-[0.98]"
      >
        {auth ? "Get API key →" : "API docs →"}
      </a>
    </div>
  );
}

/**
 * Market image with a fixed slot, so rows stay aligned when Panta has no image or the
 * upstream URL 404s (the broken image is swapped for a neutral placeholder).
 */
function MarketThumb({ src, variant, untitled }: { src?: string; variant: "row" | "card"; untitled?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const ok = src && failed !== src;
  if (variant === "row") {
    return ok ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        onError={() => setFailed(src)}
        className="hidden h-10 w-10 shrink-0 rounded object-cover sm:block"
      />
    ) : (
      <span aria-hidden="true" className="hidden h-10 w-10 shrink-0 rounded border border-line bg-elevated sm:block" />
    );
  }
  return ok ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      onError={() => setFailed(src)}
      className="h-28 w-full object-cover opacity-90 transition group-hover:opacity-100"
    />
  ) : (
    <div className="flex h-16 items-center justify-center bg-elevated text-[10px] uppercase tracking-wider text-zinc-700">
      {untitled ? "Untitled" : "No image"}
    </div>
  );
}

export function MarketList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q") || "";

  const [category, setCategory] = useState("");
  const [phase, setPhase] = useState(""); // All — API status=primary often ships thin/untitled
  const [sort, setSort] = useState<SortMode>("default");
  const [view, setView] = useState<ViewMode>("rows");
  const [q, setQ] = useState(initialQ);
  const [watchOnly, setWatchOnly] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { ids: watchIds } = useWatchlist();
  const { ids: recentIds } = useRecents();

  // Shared catalog cache: same filter → same entry as the landing strip,
  // command palette and execute picker; nothing here refetches on its own.
  const catalog = useCatalog({ category, status: phase });
  const categories = useCategories().data ?? [];
  const busy = catalog.isFetching;
  const error = catalog.error ? describeErr(catalog.error) : null;
  const updatedAt = catalog.dataUpdatedAt || null;

  // Catalog paints immediately; detail hydrates only for rows in/near the
  // viewport (IntersectionObserver), ≤4 in flight via the shared limiter.
  const { visible, track } = useViewportIds();
  const details = useHydratedDetails(catalog.items, visible);
  const items = useMemo(
    () => catalog.items.map((m) => mergeMarket(m, details.get(m.marketId))),
    [catalog.items, details],
  );

  // Persist search in URL ?q=
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (q.trim()) params.set("q", q.trim());
      else params.delete("q");
      const next = params.toString();
      const cur = searchParams.toString();
      if (next !== cur) {
        router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, pathname, router, searchParams]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);


  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let list = items.filter((m) => {
      if (watchOnly && !watchIds.includes(m.marketId)) return false;
      if (!phaseMatches(m, phase)) return false;
      if (!qq) return true;
      const label = marketLabel(m).toLowerCase();
      return (
        label.includes(qq) ||
        m.marketId.toLowerCase().includes(qq) ||
        (m.category || "").toLowerCase().includes(qq) ||
        (m.title || "").toLowerCase().includes(qq) ||
        (m.description || "").toLowerCase().includes(qq)
      );
    });

    const phaseRank = (p?: string) => {
      const x = (p || "").toLowerCase();
      if (x === "primary") return 0;
      if (x === "secondary") return 1;
      if (x === "resolved") return 2;
      if (x === "cancelled") return 3;
      return 4;
    };

    if (sort === "volume") {
      list = [...list].sort((a, b) => volumeNum(b) - volumeNum(a));
    } else if (sort === "ending") {
      list = [...list].sort((a, b) => {
        const ae = a.endTime ?? Number.POSITIVE_INFINITY;
        const be = b.endTime ?? Number.POSITIVE_INFINITY;
        return ae - be;
      });
    } else if (sort === "phase") {
      list = [...list].sort(
        (a, b) => phaseRank(a.phase) - phaseRank(b.phase),
      );
    } else {
      // Default: labeled + priced + active first so cold catalog doesn't look dead
      list = [...list].sort((a, b) => {
        const al = hasHumanLabel(a) ? 0 : 1;
        const bl = hasHumanLabel(b) ? 0 : 1;
        if (al !== bl) return al - bl;
        const ap = hasAnySpot(a) ? 0 : 1;
        const bp = hasAnySpot(b) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        const pr = phaseRank(a.phase) - phaseRank(b.phase);
        if (pr !== 0) return pr;
        return volumeNum(b) - volumeNum(a);
      });
    }
    return list;
  }, [items, q, sort, watchOnly, watchIds, phase]);

  const showSetup = Boolean(error && items.length === 0);
  const showSkeleton = busy && items.length === 0 && !error;

  const missingWatch = useMemo(() => {
    if (!watchOnly) return [] as string[];
    const present = new Set(items.map((m) => m.marketId));
    return watchIds.filter((id) => !present.has(id));
  }, [watchOnly, watchIds, items]);

  const recentMarkets = useMemo(() => {
    const byId = new Map(items.map((m) => [m.marketId, m]));
    return recentIds
      .map((id) => byId.get(id) ?? ({ marketId: id } as Market))
      .slice(0, 6);
  }, [items, recentIds]);

  const openMarket = (id: string) => {
    pushRecent(id);
    notifyStorage();
  };

  // Keyboard highlight resets whenever the filter changes (state keyed on the
  // filter, no reset effects) and is clamped to the visible list.
  const filterKey = `${q}|${category}|${phase}|${sort}|${watchOnly}|${view}`;
  const [hl, setHl] = useState({ key: filterKey, idx: 0 });
  const rawHighlight = hl.key === filterKey ? hl.idx : 0;
  const highlight = filtered.length ? Math.min(rawHighlight, filtered.length - 1) : 0;
  const setHighlight = (idx: number) => setHl({ key: filterKey, idx });

  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (filtered.length === 0) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setHl({ key: filterKey, idx: Math.min(filtered.length - 1, highlight + 1) });
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setHl({ key: filterKey, idx: Math.max(0, highlight - 1) });
        return;
      }
      if (e.key === "Enter") {
        const m = filtered[Math.min(Math.max(highlight, 0), filtered.length - 1)];
        if (!m) return;
        e.preventDefault();
        openMarket(m.marketId);
        router.push(`/markets/${encodeURIComponent(m.marketId)}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, highlight, router, filterKey]);


  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Trading desk</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.02em] text-ink">Markets</h1>
          <p className="mt-1 text-[13px] text-ink-3">
            Live Panta catalog
            <span> · open phase is not the same as liquidity · ↑↓ to move, Enter to open, / to search</span>
            {updatedAt ? (
              <span className="ml-1.5 font-num text-zinc-600">
                · Updated {formatUpdated(updatedAt)} IST
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="segmented" role="group" aria-label="Layout">
            <button type="button" aria-pressed={view === "rows"} onClick={() => setView("rows")}>
              Rows
            </button>
            <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}>
              Cards
            </button>
          </div>
          <button type="button" onClick={() => void catalog.refetch()} className="btn btn-secondary btn-sm" disabled={busy}>
            {busy ? "Syncing…" : "Refresh"}
          </button>
        </div>
      </div>

      {recentIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="type-section">Recent</span>
          {recentMarkets.map((m) => (
            <Link
              key={m.marketId}
              href={`/markets/${encodeURIComponent(m.marketId)}`}
              onClick={() => openMarket(m.marketId)}
              className="max-w-[180px] truncate rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-zinc-300 transition hover:border-cyan-400/30 hover:text-cyan-300"
              title={marketLabel(m)}
            >
              {marketLabel(m)}
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
      <Panel flush>
        <div className="space-y-2.5 border-b border-line px-3.5 py-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1">
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search markets…"
                aria-label="Search markets"
                className="field pr-8"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-num text-[10px] text-zinc-600">
                /
              </span>
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              aria-label="Sort markets"
              className="field !w-auto"
            >
              <option value="default">Sort: Default</option>
              <option value="volume">Sort: Volume</option>
              <option value="ending">Sort: Ending soon</option>
              <option value="phase">Sort: Phase</option>
            </select>
            <select
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              aria-label="Filter by phase"
              className="field !w-auto"
            >
              <option value="">All phases</option>
              <option value="primary">Primary (open)</option>
              <option value="secondary">Secondary</option>
              <option value="resolved">Resolved</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div
            className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="listbox"
            aria-label="Categories"
          >
            <button
              type="button"
              role="option"
              aria-selected={watchOnly}
              onClick={() => setWatchOnly((v) => !v)}
              className="chip"
            >
              ★ Watchlist{watchIds.length ? ` (${watchIds.length})` : ""}
            </button>
            <button
              type="button"
              role="option"
              aria-selected={category === "" && !watchOnly}
              onClick={() => {
                setCategory("");
                setWatchOnly(false);
              }}
              className="chip capitalize"
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={category === c && !watchOnly}
                onClick={() => {
                  setCategory(c);
                  setWatchOnly(false);
                }}
                className="chip capitalize"
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {showSetup ? (
          <SetupPanel error={error!} />
        ) : (
          <>
            {error && !showSetup && (
              <div className="mx-3.5 mt-3 rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </div>
            )}

            {showSkeleton ? (
              <SkeletonRows />
            ) : view === "cards" ? (
              <div className="grid gap-3 p-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((m, idx) => {
                  const { yes, no } = impliedSide(m);
                  const thumb = m.images?.[0];
                  const hi = idx === highlight;
                  return (
                    <div
                      key={m.marketId}
                      ref={track(m.marketId)}
                      data-hi={hi ? "1" : undefined}
                      onMouseEnter={() => setHighlight(idx)}
                      className={`relative overflow-hidden rounded-lg border bg-inset transition ${hi ? "border-cyan-400/45 ring-1 ring-cyan-400/25" : "border-line hover:border-line-strong"}`}
                    >
                      <div className="absolute right-2 top-2 z-10">
                        <WatchStar marketId={m.marketId} size="sm" />
                      </div>
                      <Link
                        href={`/markets/${encodeURIComponent(m.marketId)}`}
                        onClick={() => openMarket(m.marketId)}
                        className="group flex min-h-[44px] flex-col active:scale-[0.99]"
                      >
                      <MarketThumb src={thumb} variant="card" untitled={isUntitledMarket(m)} />
                      <div className="flex flex-1 flex-col gap-2 p-3">
                        <div
                          className={`market-title market-title--link ${
                            isUntitledMarket(m) ? "market-title--untitled" : ""
                          }`}
                        >
                          {marketLabel(m)}
                        </div>
                        {isUntitledMarket(m) ? (
                          <div className="market-sub font-num">{marketSubtitle(m)}</div>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <PhaseBadge phase={m.phase} />
                          {shouldShowCategoryChip(m.category, m.title, m.description) ? (
                            <span className="rounded border border-line px-1 py-px text-[10px] text-zinc-500">
                              {m.category}
                            </span>
                          ) : null}
                        </div>
                        <ProbBar yes={yes} no={no} size="sm" showLabels />
                        <div className="mt-auto flex justify-between font-num text-[10px] text-zinc-500">
                          <span>{formatVolumeUsdc(catalogVolume(m))}</span>
                          <span>Ends {formatEnd(m.endTime)}</span>
                        </div>
                      </div>
                      </Link>
                    </div>
                  );
                })}
                {!busy && !error && filtered.length === 0 && (
                  <div className="col-span-full px-4 py-14 text-center">
                    <div className="text-sm text-zinc-400">No markets match</div>
                    <p className="mt-1 text-[11px] text-zinc-600">
                      Clear search, phase, or watchlist — sparse catalogs are common on cold books
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setQ("");
                        setWatchOnly(false);
                        setCategory("");
                        setPhase("");
                      }}
                      className="mt-3 rounded-md border border-line px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="divide-y divide-line">
                <div className="type-col hidden grid-cols-[1fr_88px_96px_110px] gap-3 px-4 py-1.5 sm:grid lg:grid-cols-[1fr_88px_96px_96px_110px]">
                  <span>Market</span>
                  <span>Phase</span>
                  <span className="hidden lg:inline">Volume</span>
                  <span className="text-right">Ends</span>
                  <span className="text-right">Prob</span>
                </div>

                {filtered.map((m, idx) => {
                  const { yes, no } = impliedSide(m);
                  const thumb = m.images?.[0];
                  const hi = idx === highlight;
                  return (
                    <div
                      key={m.marketId}
                      ref={track(m.marketId)}
                      data-hi={hi ? "1" : undefined}
                      onMouseEnter={() => setHighlight(idx)}
                      className={`flex items-stretch gap-1 transition-colors ${hi ? "bg-cyan-400/[0.06] ring-1 ring-inset ring-cyan-400/30" : "hover:bg-elevated"}`}
                    >
                      <div className="flex items-center pl-3">
                        <WatchStar marketId={m.marketId} size="sm" />
                      </div>
                      <Link
                        href={`/markets/${encodeURIComponent(m.marketId)}`}
                        onClick={() => openMarket(m.marketId)}
                        className="group desk-row grid flex-1 grid-cols-1 items-center gap-3 px-3 desk-row-pad transition-colors sm:grid-cols-[1fr_88px_96px_110px] lg:grid-cols-[1fr_88px_96px_96px_110px]"
                      >
                      <div className="flex min-w-0 items-center gap-3">
                        <MarketThumb src={thumb} variant="row" />
                        <div className="min-w-0">
                          <div
                            className={`market-title market-title--link ${
                              isUntitledMarket(m) ? "market-title--untitled" : ""
                            }`}
                          >
                            {marketLabel(m, { max: 120 })}
                          </div>
                          <div className="market-sub">
                            {shouldShowCategoryChip(m.category, m.title, m.description) ? (
                              <span className="cat-chip">{m.category}</span>
                            ) : null}
                            <span className="font-num">{marketSubtitle(m)}</span>
                            <span className="font-num lg:hidden">
                              · {formatVolumeUsdc(catalogVolume(m))}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div>
                        <PhaseBadge phase={m.phase} />
                      </div>
                      <div className="hidden font-num text-[12px] tabular-nums text-zinc-400 lg:block">
                        {formatVolumeUsdc(catalogVolume(m))}
                      </div>
                      <div className="hidden whitespace-nowrap text-right font-num text-[11px] tabular-nums text-zinc-500 sm:block">
                        {formatEnd(m.endTime)}
                      </div>
                      <div className="sm:text-right">
                        <ProbBar yes={yes} no={no} size="sm" showLabels />
                      </div>
                      </Link>
                    </div>
                  );
                })}

                {!busy && !error && filtered.length === 0 && (
                  <div className="px-4 py-14 text-center">
                    <div className="text-sm text-zinc-400">No markets match</div>
                    <p className="mt-1 text-[11px] text-zinc-600">
                      Clear search, phase, or watchlist — sparse catalogs are common on cold books
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setQ("");
                        setWatchOnly(false);
                        setCategory("");
                        setPhase("");
                      }}
                      className="mt-3 rounded-md border border-line px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            )}

            {missingWatch.length > 0 && (
              <div className="border-t border-line px-3.5 py-3">
                <div className="type-section mb-2">Watched · not on this page</div>
                <div className="flex flex-wrap gap-2">
                  {missingWatch.map((id) => (
                    <div key={id} className="flex items-center gap-1">
                      <WatchStar marketId={id} size="sm" />
                      <Link
                        href={`/markets/${encodeURIComponent(id)}`}
                        onClick={() => openMarket(id)}
                        className="rounded-md border border-line px-2 py-1 font-num text-[11px] text-zinc-400 hover:border-cyan-400/30 hover:text-cyan-300"
                      >
                        {id.slice(0, 8)}…
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {catalog.hasNextPage && !watchOnly && (
              <div className="flex justify-center border-t border-line py-3">
                <button
                  type="button"
                  disabled={catalog.isFetchingNextPage}
                  onClick={() => void catalog.fetchNextPage()}
                  className="rounded-md border border-line bg-inset px-4 py-2 text-sm text-zinc-300 transition hover:border-line-strong hover:text-zinc-100 active:scale-[0.98] disabled:opacity-40"
                >
                  Load more
                </button>
              </div>
            )}
          </>
        )}
      </Panel>
      <aside className="hidden lg:block lg:sticky lg:top-16">
        <HotTapeRail markets={filtered} watchIds={watchIds} />
      </aside>
      </div>
    </div>
  );
}
