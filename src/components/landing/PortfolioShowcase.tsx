"use client";

import { useId, useState } from "react";
import { StatusBadge, type StatusTone } from "../ui/StatusBadge";
import { IconExternal } from "../ui/Icons";

type R = { market: string; side: "YES" | "NO"; amount: string; status: string; tone: StatusTone; sig?: string };
const DATA: Record<string, { cols: string[]; rows: R[]; note: string }> = {
  positions: {
    cols: ["Market", "Side", "Size", "Status"],
    note: "Positions come from your wallet's Panta holdings.",
    rows: [
      { market: "Sample market A", side: "YES", amount: "38.4 sh", status: "Open", tone: "info" },
      { market: "Sample market B", side: "NO", amount: "12.0 sh", status: "Claimable", tone: "live" },
      { market: "Sample market C", side: "YES", amount: "20.5 sh", status: "Pending", tone: "pending" },
    ],
  },
  claims: {
    cols: ["Market", "Side", "Payout", "Status"],
    note: "Claims appear once a market resolves in your favour.",
    rows: [
      { market: "Sample market B", side: "NO", amount: "12.00 USDC", status: "Claimable", tone: "live" },
      { market: "Sample market D", side: "YES", amount: "8.40 USDC", status: "Claimed", tone: "success", sig: "4gZ…pQ1" },
      { market: "Sample market E", side: "YES", amount: "5.10 USDC", status: "Failed", tone: "error" },
    ],
  },
  activity: {
    cols: ["Market", "Side", "Amount", "Status"],
    note: "Transaction confirmation and attribution are tracked separately.",
    rows: [
      { market: "Sample market A", side: "YES", amount: "25.00 USDC", status: "Verified", tone: "success", sig: "5kT…9xR" },
      { market: "Sample market C", side: "YES", amount: "15.00 USDC", status: "Submitted", tone: "info", sig: "2mV…Lw8" },
      { market: "Sample market F", side: "NO", amount: "10.00 USDC", status: "Confirmed", tone: "success", sig: "3hQ…c7N" },
    ],
  },
};
const TABS = [
  ["positions", "Positions"],
  ["claims", "Claims"],
  ["activity", "Activity"],
] as const;

/** Positions / claims / activity tables with sample rows (the Book's layout). */
export function PortfolioTables() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("positions");
  const base = useId();
  const d = DATA[tab];
  return (
  <div className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label="Book sections" className="segmented">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${base}-${id}`}
            aria-selected={tab === id}
            aria-controls={`${base}-panel`}
            tabIndex={tab === id ? 0 : -1}
            className="min-h-11 sm:min-h-[30px]"
            onClick={() => setTab(id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = TABS.findIndex(([t]) => t === tab);
              const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0];
              setTab(next);
              document.getElementById(`${base}-${next}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="rounded-md border border-amber-400/50 bg-amber-400/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-200">
        Illustrative · sample rows
      </span>
    </div>
    <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-${tab}`} className="mt-3 overflow-x-auto">
      <table className="w-full min-w-0 sm:min-w-[480px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-3">
            {d.cols.map((c) => (
              <th key={c} scope="col" className="px-2 py-2 font-semibold sm:px-3">
                {c}
              </th>
            ))}
            <th scope="col" className="hidden px-3 py-2 text-right font-semibold sm:table-cell">
              Explorer
            </th>
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.market + r.status} className="border-b border-line/50">
              <td className="px-2 py-2.5 sm:px-3 text-ink">{r.market}</td>
              <td className={`px-2 py-2.5 sm:px-3 font-semibold ${r.side === "YES" ? "text-emerald-300" : "text-rose-300"}`}>{r.side}</td>
              <td className="font-num px-2 py-2.5 sm:px-3 text-ink-2">{r.amount}</td>
              <td className="px-2 py-2.5 sm:px-3">
                <StatusBadge tone={r.tone} size="xs">
                  {r.status}
                </StatusBadge>
              </td>
              <td className="hidden px-2 py-2.5 sm:px-3 text-right sm:table-cell">
                {r.sig ? (
                  <span className="font-addr inline-flex items-center gap-1 text-ink-3" title="Real rows link to Solscan">
                    {r.sig} <IconExternal className="h-3 w-3" />
                  </span>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="mt-2 text-[12px] text-ink-3">{d.note}</p>
  </div>
  );
}
