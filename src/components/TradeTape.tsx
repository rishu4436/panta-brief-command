"use client";

import type { CatalogTradeRow } from "@/lib/types";
import { formatBlockTime, formatVolumeUsdc, shortAddr } from "@/lib/format";
import { Panel } from "./Panel";

function rowSide(t: CatalogTradeRow): string {
  if (t.side) return t.side.toUpperCase();
  const y = Number(t.yesAmount ?? 0);
  const n = Number(t.noAmount ?? 0);
  if (y > n) return "YES";
  if (n > y) return "NO";
  return "—";
}

function rowSize(t: CatalogTradeRow): string {
  if (t.amountUsdc) return formatVolumeUsdc(t.amountUsdc);
  const y = t.yesAmount ?? "—";
  const n = t.noAmount ?? "—";
  return `Y ${y} / N ${n}`;
}

export function TradeTape({
  items,
  busy,
}: {
  items: CatalogTradeRow[];
  busy?: boolean;
}) {
  return (
    <Panel title="Trade tape" flush>
      <div className="max-h-96 overflow-y-auto">
        {busy && items.length === 0 && (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-8 w-full" />
            ))}
          </div>
        )}

        {!busy || items.length > 0 ? (
          <div className="sticky top-0 z-10 grid grid-cols-[52px_1fr_88px_72px] gap-2 border-b border-[#1f1f23] bg-[#111113]/95 px-3.5 py-1.5 text-[9px] font-medium uppercase tracking-wider text-zinc-600 backdrop-blur-sm sm:grid-cols-[52px_1fr_100px_88px_72px]">
            <span>Side</span>
            <span>Size</span>
            <span className="hidden sm:inline">Wallet</span>
            <span>Time</span>
            <span className="text-right">Tag</span>
          </div>
        ) : null}

        <div className="divide-y divide-[#1f1f23]">
          {items.map((t, i) => {
            const side = rowSide(t);
            const sideColor =
              side === "YES"
                ? "text-emerald-400"
                : side === "NO"
                  ? "text-rose-400"
                  : "text-zinc-500";
            return (
              <div
                key={`${t.signature || t.id || i}`}
                className="grid grid-cols-[52px_1fr_88px_72px] items-center gap-2 px-3.5 py-1.5 text-[11px] transition-colors hover:bg-[#161618] sm:grid-cols-[52px_1fr_100px_88px_72px]"
              >
                <span className={`font-num font-semibold ${sideColor}`}>
                  {side}
                </span>
                <span className="truncate font-num text-zinc-300">
                  {rowSize(t)}
                </span>
                <span className="hidden font-num text-[10px] text-zinc-600 sm:inline">
                  {shortAddr(t.wallet, 4)}
                </span>
                <span className="font-num text-[10px] text-zinc-500">
                  {formatBlockTime(t.blockTime)}
                </span>
                <span className="text-right">
                  {t.isPrimary ? (
                    <span className="rounded border border-cyan-400/25 px-1 py-px text-[9px] uppercase tracking-wide text-cyan-400/80">
                      primary
                    </span>
                  ) : (
                    <span className="text-[9px] text-zinc-700">—</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {!busy && items.length === 0 && (
          <div className="px-4 py-10 text-center">
            <div className="text-sm text-zinc-600">No prints yet</div>
            <p className="mt-1 text-[11px] text-zinc-700">
              Tape fills as primary / secondary flow
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
