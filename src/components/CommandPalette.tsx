"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pantaFetch } from "@/lib/api";
import { marketLabel } from "@/lib/format";
import { getRecents, getWatchlist, notifyStorage, pushRecent } from "@/lib/storage";
import type { MarketCatalogItem, MarketsListResponse } from "@/lib/types";

type Row = {
  marketId: string;
  label: string;
  hint: string;
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [catalog, setCatalog] = useState<MarketCatalogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const { data } = await pantaFetch<MarketsListResponse>("/markets/", {
        query: { limit: "40" },
      });
      setCatalog(data.items || []);
    } catch {
      setCatalog([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("panta-brief-cmdk", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("panta-brief-cmdk", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    void load();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, load]);

  const rows: Row[] = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const watched = new Set(getWatchlist());
    const recent = getRecents();

    const fromCatalog = catalog.map((m) => ({
      marketId: m.marketId,
      label: marketLabel(m),
      hint: [
        watched.has(m.marketId) ? "★" : null,
        m.category || null,
        m.phase || null,
      ]
        .filter(Boolean)
        .join(" · "),
    }));

    // Prefer recents at top when query empty
    let list = fromCatalog;
    if (!qq && recent.length) {
      const byId = new Map(fromCatalog.map((r) => [r.marketId, r]));
      const head: Row[] = [];
      for (const id of recent) {
        const hit = byId.get(id);
        if (hit) head.push({ ...hit, hint: `Recent · ${hit.hint || ""}`.trim() });
        else head.push({ marketId: id, label: id.slice(0, 12) + "…", hint: "Recent" });
      }
      const headIds = new Set(head.map((h) => h.marketId));
      list = [...head, ...fromCatalog.filter((r) => !headIds.has(r.marketId))];
    }

    if (!qq) return list.slice(0, 12);
    return list
      .filter(
        (r) =>
          r.label.toLowerCase().includes(qq) ||
          r.marketId.toLowerCase().includes(qq) ||
          (r.hint || "").toLowerCase().includes(qq),
      )
      .slice(0, 12);
  }, [catalog, q]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  const jump = (id: string) => {
    pushRecent(id);
    notifyStorage();
    setOpen(false);
    router.push(`/markets/${encodeURIComponent(id)}`);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Jump to market"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-[#2a2a2e] bg-[#111113] shadow-2xl shadow-black/50 animate-fade-in">
        <div className="flex items-center gap-2 border-b border-[#1f1f23] px-3">
          <span className="text-[12px] text-zinc-500">⌘K</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to market…"
            aria-label="Search markets"
            className="flex-1 bg-transparent py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, Math.max(0, rows.length - 1)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && rows[active]) {
                e.preventDefault();
                jump(rows[active].marketId);
              }
            }}
          />
          <kbd className="hidden rounded border border-[#1f1f23] px-1.5 py-0.5 font-num text-[10px] text-zinc-600 sm:inline">
            esc
          </kbd>
        </div>
        <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
          {busy && rows.length === 0 && (
            <li className="px-3 py-4 text-center text-[12px] text-zinc-500">
              Loading catalog…
            </li>
          )}
          {!busy && rows.length === 0 && (
            <li className="px-3 py-4 text-center text-[12px] text-zinc-500">
              No markets match
            </li>
          )}
          {rows.map((r, i) => (
            <li key={r.marketId} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => jump(r.marketId)}
                className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition ${
                  i === active ? "bg-[#161618]" : "hover:bg-[#161618]/70"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-zinc-100">
                    {r.label}
                  </div>
                  {r.hint ? (
                    <div className="mt-0.5 truncate text-[10px] text-zinc-500">
                      {r.hint}
                    </div>
                  ) : null}
                </div>
                <span className="shrink-0 font-num text-[10px] text-zinc-600">
                  {r.marketId.slice(0, 6)}…
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-[#1f1f23] px-3 py-2 text-[10px] text-zinc-600">
          ↑↓ navigate · Enter open · Esc close · Powered by Panta
        </div>
      </div>
    </div>
  );
}
