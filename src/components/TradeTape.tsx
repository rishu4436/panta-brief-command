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
              <div key={i} className="skeleton h-10 w-full" />
            ))}
          </div>
        )}
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
                className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[12px] transition-colors hover:bg-[#161618]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-num font-semibold ${sideColor}`}>
                      {side}
                    </span>
                    {t.isPrimary ? (
                      <span className="rounded border border-cyan-400/25 px-1 py-px text-[9px] uppercase tracking-wide text-cyan-400/80">
                        primary
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 font-num text-[10px] text-zinc-600">
                    {shortAddr(t.wallet, 5)} · {formatBlockTime(t.blockTime)}
                  </div>
                </div>
                <div className="shrink-0 text-right font-num text-zinc-300">
                  {t.amountUsdc
                    ? formatVolumeUsdc(t.amountUsdc)
                    : `Y ${t.yesAmount ?? "—"} / N ${t.noAmount ?? "—"}`}
                </div>
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
