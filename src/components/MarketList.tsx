"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { pantaFetch } from "@/lib/api";
import { describeErr } from "@/lib/errors";
import { formatVolumeUsdc, impliedSide, marketLabel } from "@/lib/format";
import { notifyStorage, pushRecent } from "@/lib/storage";
import type {
  CategoriesResponse,
  MarketCatalogItem,
  MarketsListResponse,
} from "@/lib/types";
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
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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

function volumeNum(m: MarketCatalogItem): number {
  const v = m.volumeUsdc ?? m.totalVolumeUsdc ?? 0;
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function SkeletonRows() {
  return (
    <div className="divide-y divide-[#1f1f23]">
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
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-400 text-lg font-black text-[#0a0a0b]">
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
        <code className="mt-4 rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-3 py-2 font-num text-[12px] text-cyan-300">
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
        className="mt-6 inline-flex items-center rounded-md bg-cyan-400 px-4 py-2 text-sm font-semibold text-[#0a0a0b] transition hover:bg-cyan-300 active:scale-[0.98]"
      >
        {auth ? "Get API key →" : "API docs →"}
      </a>
    </div>
  );
}

export function MarketList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q") || "";

  const [items, setItems] = useState<MarketCatalogItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [phase, setPhase] = useState("primary");
  const [sort, setSort] = useState<SortMode>("default");
  const [view, setView] = useState<ViewMode>("rows");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(initialQ);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [watchOnly, setWatchOnly] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [highlight, setHighlight] = useState(0);
  const { ids: watchIds } = useWatchlist();
  const { ids: recentIds } = useRecents();

  const loadCategories = useCallback(async () => {
    try {
      const { data } = await pantaFetch<CategoriesResponse>("/categories/");
      setCategories(data.categories || []);
    } catch {
      /* optional */
    }
  }, []);

  const hydrateTitles = useCallback(async (batch: MarketCatalogItem[]) => {
    const need = batch.filter((m) => !(m.title || "").trim() && !(m.description || "").trim());
    if (need.length === 0) return;
    const concurrency = 4;
    let idx = 0;
    const updates = new Map<string, Partial<MarketCatalogItem>>();

    async function worker() {
      while (idx < need.length) {
        const m = need[idx++];
        try {
          const { data } = await pantaFetch<MarketCatalogItem>(
            `/markets/${encodeURIComponent(m.marketId)}/`,
          );
          const title = (data.title || "").trim();
          const description = (data.description || "").trim();
          if (title || description) {
            updates.set(m.marketId, {
              title: title || description,
              description: description || data.description,
              oracle: data.oracle ?? m.oracle,
              volumeUsdc: data.volumeUsdc ?? m.volumeUsdc,
              yesPrice: data.yesPrice ?? m.yesPrice,
              noPrice: data.noPrice ?? m.noPrice,
              primaryYesPrice: data.primaryYesPrice ?? m.primaryYesPrice,
              primaryNoPrice: data.primaryNoPrice ?? m.primaryNoPrice,
              secondaryYesPrice: data.secondaryYesPrice ?? m.secondaryYesPrice,
              secondaryNoPrice: data.secondaryNoPrice ?? m.secondaryNoPrice,
              images: data.images?.length ? data.images : m.images,
              phase: data.phase || m.phase,
            });
          }
        } catch {
          /* soft-fail per market */
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (updates.size === 0) return;
    setItems((prev) =>
      prev.map((m) => (updates.has(m.marketId) ? { ...m, ...updates.get(m.marketId) } : m)),
    );
  }, []);

  const loadMarkets = useCallback(
    async (opts?: { append?: boolean; cursor?: string | null }) => {
      setBusy(true);
      setError(null);
      try {
        const { data } = await pantaFetch<MarketsListResponse>("/markets/", {
          query: {
            category: category || undefined,
            status: phase || undefined,
            limit: "24",
            cursor: opts?.cursor || undefined,
          },
        });
        const next = data.items || [];
        setItems((prev) => (opts?.append ? [...prev, ...next] : next));
        setNextCursor(data.nextCursor ?? null);
        setUpdatedAt(Date.now());
        void hydrateTitles(next);
      } catch (e) {
        setError(describeErr(e));
      } finally {
        setBusy(false);
      }
    },
    [category, phase, hydrateTitles],
  );

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void loadMarkets();
  }, [loadMarkets]);

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
      if (!qq) return true;
      const label = marketLabel(m).toLowerCase();
      return (
        label.includes(qq) ||
        m.marketId.toLowerCase().includes(qq) ||
        (m.category || "").toLowerCase().includes(qq) ||
        (m.title || "").toLowerCase().includes(qq)
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
      // Default: active phases first, then volume
      list = [...list].sort((a, b) => {
        const pr = phaseRank(a.phase) - phaseRank(b.phase);
        if (pr !== 0) return pr;
        return volumeNum(b) - volumeNum(a);
      });
    }
    return list;
  }, [items, q, sort, watchOnly, watchIds]);

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
      .map((id) => byId.get(id) ?? ({ marketId: id } as MarketCatalogItem))
      .slice(0, 6);
  }, [items, recentIds]);

  const openMarket = (id: string) => {
    pushRecent(id);
    notifyStorage();
  };

  useEffect(() => {
    setHighlight(0);
  }, [q, category, phase, sort, watchOnly, view, items.length]);

  useEffect(() => {
    if (filtered.length === 0) {
      setHighlight(0);
      return;
    }
    setHighlight((h) => Math.min(h, filtered.length - 1));
  }, [filtered.length]);

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
        setHighlight((h) => Math.min(filtered.length - 1, h + 1));
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
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
  }, [filtered, highlight, router]);

  const chipCls = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1.5 text-[12px] transition active:scale-[0.98] ${
      active
        ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
        : "border-[#1f1f23] bg-[#0a0a0b] text-zinc-400 hover:border-[#2a2a2e] hover:text-zinc-200"
    }`;

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-50">
            Markets
          </h1>
          <p className="mt-0.5 text-[12px] text-zinc-400">
            USDC catalog ·{" "}
            <kbd className="rounded border border-[#1f1f23] px-1 font-num text-[10px] text-zinc-500">
              j
            </kbd>
            /
            <kbd className="rounded border border-[#1f1f23] px-1 font-num text-[10px] text-zinc-500">
              k
            </kbd>{" "}
            ·{" "}
            <kbd className="rounded border border-[#1f1f23] px-1 font-num text-[10px] text-zinc-500">
              Enter
            </kbd>{" "}
            ·{" "}
            <kbd className="rounded border border-[#1f1f23] px-1 font-num text-[10px] text-zinc-500">
              /
            </kbd>{" "}
            ·{" "}
            <kbd className="rounded border border-[#1f1f23] px-1 font-num text-[10px] text-zinc-500">
              ⌘K
            </kbd>
            {updatedAt ? (
              <span className="ml-2 font-num text-zinc-600">
                · Updated {formatUpdated(updatedAt)} IST
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-[#1f1f23] bg-[#0a0a0b] p-0.5">
            <button
              type="button"
              aria-pressed={view === "rows"}
              onClick={() => setView("rows")}
              className={`rounded px-2.5 py-1 text-[11px] transition ${
                view === "rows"
                  ? "bg-[#161618] text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Rows
            </button>
            <button
              type="button"
              aria-pressed={view === "cards"}
              onClick={() => setView("cards")}
              className={`rounded px-2.5 py-1 text-[11px] transition ${
                view === "cards"
                  ? "bg-[#161618] text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Cards
            </button>
          </div>
          <button
            type="button"
            onClick={() => void loadMarkets()}
            className="rounded-md border border-[#1f1f23] bg-[#111113] px-2.5 py-1.5 text-[11px] text-zinc-400 transition hover:border-[#2a2a2e] hover:text-zinc-200 active:scale-[0.98]"
            disabled={busy}
          >
            {busy ? "Syncing…" : "Refresh"}
          </button>
        </div>
      </div>

      {recentIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Recent
          </span>
          {recentMarkets.map((m) => (
            <Link
              key={m.marketId}
              href={`/markets/${encodeURIComponent(m.marketId)}`}
              onClick={() => openMarket(m.marketId)}
              className="max-w-[180px] truncate rounded-full border border-[#1f1f23] bg-[#111113] px-2.5 py-1 text-[11px] text-zinc-300 transition hover:border-cyan-400/30 hover:text-cyan-300"
              title={marketLabel(m)}
            >
              {marketLabel(m)}
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
      <Panel flush>
        <div className="space-y-2.5 border-b border-[#1f1f23] px-3.5 py-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1">
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search markets…"
                aria-label="Search markets"
                className="w-full rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-3 py-2 pr-8 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/40"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-num text-[10px] text-zinc-600">
                /
              </span>
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              aria-label="Sort markets"
              className="rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-3 py-2 text-sm text-zinc-300"
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
              className="rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-3 py-2 text-sm text-zinc-300"
            >
              <option value="">All phases</option>
              <option value="primary">primary</option>
              <option value="secondary">secondary</option>
              <option value="resolved">resolved</option>
              <option value="cancelled">cancelled</option>
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
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] transition active:scale-[0.98] ${
                watchOnly
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                  : "border-[#1f1f23] bg-[#0a0a0b] text-zinc-400 hover:border-[#2a2a2e] hover:text-zinc-200"
              }`}
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
              className={chipCls(category === "" && !watchOnly)}
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
                className={chipCls(category === c && !watchOnly)}
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
                      data-hi={hi ? "1" : undefined}
                      onMouseEnter={() => setHighlight(idx)}
                      className={`relative overflow-hidden rounded-lg border bg-[#0a0a0b] transition ${hi ? "border-cyan-400/45 ring-1 ring-cyan-400/25" : "border-[#1f1f23] hover:border-[#2a2a2e]"}`}
                    >
                      <div className="absolute right-2 top-2 z-10">
                        <WatchStar marketId={m.marketId} size="sm" />
                      </div>
                      <Link
                        href={`/markets/${encodeURIComponent(m.marketId)}`}
                        onClick={() => openMarket(m.marketId)}
                        className="group flex min-h-[44px] flex-col active:scale-[0.99]"
                      >
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumb}
                          alt=""
                          className="h-28 w-full object-cover opacity-90 transition group-hover:opacity-100"
                        />
                      ) : (
                        <div className="flex h-16 items-center justify-center bg-[#161618] text-[10px] uppercase tracking-wider text-zinc-700">
                          no image
                        </div>
                      )}
                      <div className="flex flex-1 flex-col gap-2 p-3">
                        <div className="line-clamp-2 text-[13px] font-medium text-zinc-100 group-hover:text-white">
                          {marketLabel(m)}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <PhaseBadge phase={m.phase} />
                          <span className="rounded border border-[#1f1f23] px-1 py-px text-[10px] text-zinc-500">
                            {m.category || "—"}
                          </span>
                        </div>
                        <ProbBar yes={yes} no={no} size="sm" showLabels />
                        <div className="mt-auto flex justify-between font-num text-[10px] text-zinc-500">
                          <span>{formatVolumeUsdc(m.volumeUsdc)}</span>
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
                      Adjust filters, clear watchlist filter, or refresh the catalog
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setQ("");
                        setWatchOnly(false);
                        setCategory("");
                      }}
                      className="mt-3 rounded-md border border-[#1f1f23] px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
                    >
                      Reset filters
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="divide-y divide-[#1f1f23]">
                <div className="hidden grid-cols-[1fr_88px_100px_110px] gap-3 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-zinc-600 sm:grid lg:grid-cols-[1fr_88px_100px_100px_110px]">
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
                      data-hi={hi ? "1" : undefined}
                      onMouseEnter={() => setHighlight(idx)}
                      className={`flex items-stretch gap-1 transition-colors ${hi ? "bg-cyan-400/[0.06] ring-1 ring-inset ring-cyan-400/30" : "hover:bg-[#161618]"}`}
                    >
                      <div className="flex items-center pl-3">
                        <WatchStar marketId={m.marketId} size="sm" />
                      </div>
                      <Link
                        href={`/markets/${encodeURIComponent(m.marketId)}`}
                        onClick={() => openMarket(m.marketId)}
                        className="group grid min-h-[44px] flex-1 grid-cols-1 items-center gap-3 px-3 py-3.5 transition-colors sm:grid-cols-[1fr_88px_100px_110px] lg:grid-cols-[1fr_88px_100px_100px_110px]"
                      >
                      <div className="flex min-w-0 items-center gap-3">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumb}
                            alt=""
                            className="hidden h-10 w-10 shrink-0 rounded object-cover sm:block"
                          />
                        ) : null}
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-zinc-100 group-hover:text-white">
                            {marketLabel(m)}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-600">
                            <span className="rounded border border-[#1f1f23] px-1 py-px text-zinc-500">
                              {m.category || "—"}
                            </span>
                            <span className="font-num">
                              {m.marketId.slice(0, 8)}…
                            </span>
                            <span className="font-num text-zinc-500 lg:hidden">
                              · {formatVolumeUsdc(m.volumeUsdc)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div>
                        <PhaseBadge phase={m.phase} />
                      </div>
                      <div className="hidden font-num text-[12px] text-zinc-400 lg:block">
                        {formatVolumeUsdc(m.volumeUsdc)}
                      </div>
                      <div className="hidden text-right font-num text-[11px] text-zinc-500 sm:block">
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
                      Adjust filters, clear watchlist filter, or refresh the catalog
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setQ("");
                        setWatchOnly(false);
                        setCategory("");
                      }}
                      className="mt-3 rounded-md border border-[#1f1f23] px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
                    >
                      Reset filters
                    </button>
                  </div>
                )}
              </div>
            )}

            {missingWatch.length > 0 && (
              <div className="border-t border-[#1f1f23] px-3.5 py-3">
                <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">
                  Watched · not on this page
                </div>
                <div className="flex flex-wrap gap-2">
                  {missingWatch.map((id) => (
                    <div key={id} className="flex items-center gap-1">
                      <WatchStar marketId={id} size="sm" />
                      <Link
                        href={`/markets/${encodeURIComponent(id)}`}
                        onClick={() => openMarket(id)}
                        className="rounded-md border border-[#1f1f23] px-2 py-1 font-num text-[11px] text-zinc-400 hover:border-cyan-400/30 hover:text-cyan-300"
                      >
                        {id.slice(0, 8)}…
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {nextCursor && !watchOnly && (
              <div className="flex justify-center border-t border-[#1f1f23] py-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void loadMarkets({ append: true, cursor: nextCursor })
                  }
                  className="rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-4 py-2 text-sm text-zinc-300 transition hover:border-[#2a2a2e] hover:text-zinc-100 active:scale-[0.98] disabled:opacity-40"
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
