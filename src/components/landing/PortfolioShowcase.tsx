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

export function PortfolioShowcase() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("positions");
  const base = useId();
  const d = DATA[tab];
  return (
    <section
      id="book"
      className="scroll-mt-20 border-y border-line/70 py-14 sm:py-16"
      style={{ background: "linear-gradient(120deg, rgba(59,130,246,0.09), rgba(139,92,246,0.07) 55%, rgba(8,11,18,0) 100%)" }}
      aria-labelledby="book-title"
    >
      <div className="mx-auto grid max-w-[1320px] gap-8 px-5 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
        <div>
          <p className="eyebrow">Your Book</p>
          <h2 id="book-title" className="h-section mt-3">
            After the trade.
          </h2>
          <p className="text-lede mt-3 max-w-md">Positions, claims and activity. Confirmation on Solana and attribution by Panta are shown as separate steps.</p>
          <ol className="mt-6 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[12px] text-ink-3" aria-label="Activity lifecycle">
            {(
              [
                ["Submitted", "info"],
                ["Confirmed", "success"],
                ["Verified", "success"],
              ] as const
            ).map(([label, tone], i) => (
              <li key={label} className="flex items-center gap-1.5">
                {i > 0 ? <span aria-hidden="true">→</span> : null}
                <StatusBadge tone={tone} size="xs">
                  {label}
                </StatusBadge>
              </li>
            ))}
            <li className="basis-full pt-1">Claimable positions appear once a market resolves in your favour.</li>
          </ol>
        </div>

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
      </div>
    </section>
  );
}
