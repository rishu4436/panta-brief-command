"use client";

import type { CatalogTradeRow } from "@/lib/types";
import { formatBlockTime, formatVolumeUsdc, shortAddr } from "@/lib/format";
import { GlassCard } from "./GlassCard";

function rowSide(t: CatalogTradeRow): string {
  if (t.side) return t.side.toUpperCase();
  const y = Number(t.yesAmount ?? 0);
  const n = Number(t.noAmount ?? 0);
  if (y > n) return "YES";
  if (n > y) return "NO";
  return "—";
}

export function TradeTape({
  items,
  busy,
}: {
  items: CatalogTradeRow[];
  busy?: boolean;
}) {
  return (
    <GlassCard title="Trade tape">
      {busy && <p className="mb-2 text-xs text-zinc-500">Loading tape…</p>}
      <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
        {items.map((t, i) => {
          const side = rowSide(t);
          const sideColor =
            side === "YES"
              ? "text-emerald-300"
              : side === "NO"
                ? "text-rose-300"
                : "text-zinc-400";
          return (
            <div
              key={`${t.signature || t.id || i}`}
              className="flex items-start justify-between gap-3 rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-xs"
            >
              <div>
                <div className={`font-semibold ${sideColor}`}>
                  {side}
                  {t.isPrimary ? (
                    <span className="ml-2 text-[10px] font-normal text-cyan-400/80">
                      primary
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-zinc-500">
                  {shortAddr(t.wallet, 5)} · {formatBlockTime(t.blockTime)}
                </div>
              </div>
              <div className="text-right text-zinc-300">
                {t.amountUsdc
                  ? formatVolumeUsdc(t.amountUsdc)
                  : `Y ${t.yesAmount ?? "—"} / N ${t.noAmount ?? "—"}`}
              </div>
            </div>
          );
        })}
        {!busy && items.length === 0 && (
          <p className="py-6 text-center text-sm text-zinc-500">
            No tape prints for this market.
          </p>
        )}
      </div>
    </GlassCard>
  );
}
