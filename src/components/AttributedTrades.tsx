"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccountTrades } from "@/lib/data/hooks";
import { describeErr } from "@/lib/errors";
import { formatVolumeUsdc, shortAddr } from "@/lib/format";
import { Panel } from "./Panel";

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
  return "border-[#1f1f23] text-zinc-500";
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
      title="Activity · attributed trades"
      flush
      action={
        <div className="mr-3.5 flex items-center gap-1.5">
          <div className="inline-flex rounded-md border border-[#1f1f23] bg-[#0a0a0b] p-0.5">
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
                className={`rounded px-2 py-0.5 text-[10px] ${
                  kind === v ? "bg-[#161618] text-zinc-100" : "text-zinc-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={load}
            className="rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200 active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? "…" : "Refresh"}
          </button>
        </div>
      }
    >
      <div className="border-b border-[#1f1f23] px-3.5 py-2">
        <p className="type-meta">
          GET /account/trades/ · partner attribution for this API key
        </p>
        {summary && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded border border-[#1f1f23] bg-[#0a0a0b] px-2 py-0.5 font-num text-[10px] text-zinc-400">
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
              <span className="rounded border border-[#1f1f23] bg-[#0a0a0b] px-2 py-0.5 font-num text-[10px] text-zinc-400">
                Vol {formatVolumeUsdc(vol)}
              </span>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-3.5 mt-3 rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="type-col">
            <tr className="border-b border-[#1f1f23]">
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
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((row, i) => (
              <tr
                key={`${row.signature}-${i}`}
                className="border-t border-[#1f1f23] transition-colors hover:bg-[#161618]"
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
                <td className="px-3 py-2.5 font-num text-[11px] text-zinc-500">
                  {formatCreatedAt(row.createdAt)} IST
                </td>
              </tr>
            ))}
            {!busy && !error && items.length === 0 && (
              <tr>
                <td
                  colSpan={compact ? 5 : 6}
                  className="px-3.5 py-12 text-center text-sm text-zinc-600"
                >
                  <p className="text-zinc-400">
                    Book is calm — no attributed fills yet
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Guided execute → Finish attribution (POST /trades/) lands buys
                    and claims here. Empty is honest until a live fill.
                  </p>
                  <Link
                    href="/execute"
                    className="mt-3 inline-flex items-center rounded-md bg-cyan-400 px-3 py-1.5 text-[12px] font-semibold text-[#0a0a0b] transition hover:bg-cyan-300"
                  >
                    Open execute →
                  </Link>
                </td>
              </tr>
            )}
            {busy && items.length === 0 && (
              <tr>
                <td colSpan={compact ? 5 : 6} className="px-3.5 py-8">
                  <div className="space-y-2">
                    <div className="skeleton h-4 w-full max-w-md" />
                    <div className="skeleton h-4 w-2/3 max-w-sm" />
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
