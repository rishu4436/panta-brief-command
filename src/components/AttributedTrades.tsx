"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccountTrades } from "@/lib/data/hooks";
import { describeErr } from "@/lib/errors";
import { formatVolumeUsdc, shortAddr } from "@/lib/format";
import { Panel } from "./Panel";
import { StatusBadge } from "./ui/StatusBadge";
import { EmptyState, ErrorState, SkeletonLoader } from "./ui/States";

function formatCreatedAt(iso?: string | null): string {
  if (!iso) return "—";
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return iso;
  return new Date(d).toLocaleString("en-IN", {
    timeZone: "Asia/Calcutta",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function kindCls(kind?: string | null): string {
  const k = (kind || "").toLowerCase();
  if (k === "buy") return "border-cyan-400/30 bg-cyan-400/10 text-cyan-300";
  if (k === "claim") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
  return "border-line text-zinc-500";
}

function sideCls(side?: string | null): string {
  const s = (side || "").toLowerCase();
  if (s === "yes" || s === "y") return "text-emerald-400";
  if (s === "no" || s === "n") return "text-rose-400";
  return "text-zinc-400";
}

export function AttributedTrades({
  limit = 50,
  kindFilter,
  compact = false,
}: {
  limit?: number;
  kindFilter?: "buy" | "claim" | "";
  compact?: boolean;
}) {
  const [kind, setKind] = useState<"buy" | "claim" | "">(kindFilter || "");
  // Shared ledger cache; the execute/claim flows invalidate ["accountTrades"].
  const q = useAccountTrades(limit, kind);
  const items = q.data?.items ?? [];
  const summary = q.data?.summary ?? null;
  const busy = q.isFetching;
  const error = q.error ? describeErr(q.error) : null;
  const load = () => void q.refetch();

  const total = summary?.total ?? summary?.activityTotal ?? items.length;
  const buys = summary?.buys ?? summary?.byKind?.buy;
  const claims = summary?.claims ?? summary?.byKind?.claim;
  const vol =
    summary?.volumeUsdc ??
    summary?.tradeVolumeUsdc ??
    summary?.activityValueUsdc;

  return (
    <Panel
      title="Activity"
      subtitle="Attributed trades"
      flush
      action={
        <div className="mr-2 flex items-center gap-1.5">
          <div className="segmented" role="group" aria-label="Filter activity">
            {(
              [
                ["", "All"],
                ["buy", "Buys"],
                ["claim", "Claims"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={kind === v}
                onClick={() => setKind(v)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={load}
            className="btn btn-ghost btn-sm"
          >
            {busy ? "Loading…" : "Refresh"}
          </button>
        </div>
      }
    >
      <div className="border-b border-line px-3.5 py-2">
        <p className="type-meta">
          Trades Panta has attributed to this app (GET /account/trades/). A transaction can be confirmed on Solana before
          it shows here.
        </p>
        {summary && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded border border-line bg-inset px-2 py-0.5 font-num text-[10px] text-zinc-400">
              Total {total ?? 0}
            </span>
            {buys != null && (
              <span className="rounded border border-cyan-400/20 bg-cyan-400/5 px-2 py-0.5 font-num text-[10px] text-cyan-300/90">
                Buys {buys}
              </span>
            )}
            {claims != null && (
              <span className="rounded border border-emerald-400/20 bg-emerald-400/5 px-2 py-0.5 font-num text-[10px] text-emerald-300/90">
                Claims {claims}
              </span>
            )}
            {vol != null && vol !== "" && Number(vol) > 0 && (
              <span className="rounded border border-line bg-inset px-2 py-0.5 font-num text-[10px] text-zinc-400">
                Vol {formatVolumeUsdc(vol)}
              </span>
            )}
          </div>
        )}
      </div>

      {error && (
        <ErrorState
          className="m-4"
          title="Couldn't load activity"
          description={`${error}. The attribution ledger may be busy; try again.`}
          onRetry={load}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="type-col">
            <tr className="border-b border-line">
              <th scope="col" className="px-3.5 py-2 font-medium">
                Kind
              </th>
              {!compact && (
                <th scope="col" className="px-3 py-2 font-medium">
                  Side
                </th>
              )}
              <th scope="col" className="px-3 py-2 font-medium">
                Volume
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Market
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Signature
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Attribution
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((row, i) => (
              <tr
                key={`${row.signature}-${i}`}
                className="border-t border-line transition-colors hover:bg-elevated"
              >
                <td className="px-3.5 py-2.5">
                  <span
                    className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${kindCls(row.kind)}`}
                  >
                    {row.kind || "—"}
                  </span>
                  {row.status ? (
                    <span className="ml-1.5 font-num text-[9px] text-zinc-600">
                      {row.status}
                    </span>
                  ) : null}
                </td>
                {!compact && (
                  <td
                    className={`px-3 py-2.5 font-num text-xs uppercase ${sideCls(row.side)}`}
                  >
                    {row.side || "—"}
                  </td>
                )}
                <td className="px-3 py-2.5 font-num text-xs text-zinc-300">
                  {row.amountUsdc != null
                    ? formatVolumeUsdc(row.amountUsdc)
                    : "—"}
                </td>
                <td className="px-3 py-2.5">
                  {row.marketId ? (
                    <Link
                      href={`/markets/${encodeURIComponent(row.marketId)}`}
                      className="font-num text-[11px] text-cyan-400 hover:underline"
                    >
                      {shortAddr(row.marketId, 5)}
                    </Link>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {row.signature ? (
                    <a
                      href={`https://solscan.io/tx/${row.signature}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-num text-[11px] text-cyan-400 hover:underline"
                      title={row.signature}
                    >
                      {shortAddr(row.signature, 6)}
                    </a>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge tone="success" size="xs" title="Listed in Panta's attribution ledger">
                    Verified
                  </StatusBadge>
                </td>
                <td className="px-3 py-2.5 font-num text-[11px] text-zinc-500">
                  {formatCreatedAt(row.createdAt)} IST
                </td>
              </tr>
            ))}
            {!busy && !error && items.length === 0 && (
              <tr>
                <td colSpan={compact ? 6 : 7}>
                  <EmptyState
                    title="No attributed trades yet"
                    description="Buys and win claims appear here after Panta attributes them. Until then they show as reported on the ticket."
                    action={
                      <Link href="/desk" className="btn btn-primary btn-sm">
                        Browse markets
                      </Link>
                    }
                  />
                </td>
              </tr>
            )}
            {busy && items.length === 0 && (
              <tr>
                <td colSpan={compact ? 6 : 7}>
                  <SkeletonLoader rows={3} className="p-4" label="Loading activity" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
