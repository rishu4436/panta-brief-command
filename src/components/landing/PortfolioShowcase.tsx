"use client";

import { useId, useState } from "react";
import { SectionHeader } from "../ui/SectionHeader";
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

export function PortfolioShowcase() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("positions");
  const base = useId();
  const d = DATA[tab];
  return (
    <section className="py-20 sm:py-24" aria-labelledby="book-title">
      <div className="mx-auto grid max-w-[1320px] gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
        <div>
          <SectionHeader
            eyebrow="Your activity"
            id="book-title"
            title="Everything after the trade, in one place."
            description="Keep track of your positions, claims, and transaction history."
          />
          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
            {(
              [
                ["Pending", "pending", "Waiting on the network"],
                ["Submitted", "info", "Reported to Panta"],
                ["Confirmed", "success", "Confirmed on Solana"],
                ["Verified", "success", "Matched in Panta's ledger"],
                ["Claimable", "live", "Resolved in your favour"],
                ["Failed", "error", "With a recovery step"],
              ] as const
            ).map(([label, tone, desc]) => (
              <div key={label} className="flex flex-col gap-1">
                <dt>
                  <StatusBadge tone={tone} size="xs">
                    {label}
                  </StatusBadge>
                </dt>
                <dd className="text-ink-3">{desc}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="card-elevated overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
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
            <span className="rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-200">
              Illustrative
            </span>
          </div>
          <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-${tab}`} className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-ink-3">
                  {d.cols.map((c) => (
                    <th key={c} scope="col" className="px-4 py-3 font-semibold">
                      {c}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Explorer
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.market + r.status} className="border-t border-line">
                    <td className="px-4 py-3 text-ink">{r.market}</td>
                    <td className={`px-4 py-3 font-semibold ${r.side === "YES" ? "text-emerald-300" : "text-rose-300"}`}>{r.side}</td>
                    <td className="font-num px-4 py-3 text-ink-2">{r.amount}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={r.tone} size="xs">
                        {r.status}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-right">
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
          <p className="border-t border-line px-4 py-3 text-[12px] text-ink-3">{d.note} Sample rows; real rows link to Solscan.</p>
        </div>
      </div>
    </section>
  );
}
