"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { pantaFetch } from "@/lib/api";
import { describeErr } from "@/lib/errors";
import { impliedSide, shortAddr } from "@/lib/format";
import { assertFeePayer, validatePantaInstructions } from "@/lib/panta/instructions";
import {
  confirmSignature,
  instructionsToVersionedTx,
  resolveLastValidBlockHeight,
} from "@/lib/solana";
import type {
  AccountTradesResponse,
  ClaimBuildResponse,
  CreatorFeesClaimBuildResponse,
  MarketCatalogItem,
  PositionRow,
  PositionsResponse,
  TradeReportResponse,
} from "@/lib/types";
import { Panel } from "./Panel";
import { PhaseBadge } from "./PhaseBadge";

type ClaimMode = "win" | "creator-fees";
/**
 * Claim attribution, same vocabulary as primary buys:
 * - reported   → POST /trades/ accepted, attribution not confirmed yet
 * - attributed → POST /trades/ returned `processed`, or the signature is listed
 *                in GET /account/trades/?kind=claim
 * - not-attributable → creator-fee claims (Panta docs: POST /trades/ rejects
 *                them with TX_MISMATCH), so they are never reported
 */
type ClaimAttr =
  | "idle"
  | "reporting"
  | "reported"
  | "attributed"
  | "report-failed"
  | "not-attributable";

const LEDGER_CHECK_DELAYS_MS = [1500, 3000, 5000] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CLAIM_ATTR_COPY: Record<Exclude<ClaimAttr, "idle">, { label: string; cls: string }> = {
  reporting: { label: "Reporting for attribution…", cls: "text-zinc-400" },
  reported: {
    label: "Reported for attribution · not yet in /account/trades/",
    cls: "text-zinc-300",
  },
  attributed: { label: "Attributed · listed as a claim in Activity", cls: "text-cyan-300" },
  "report-failed": {
    label: "Attribution report failed · the claim itself is confirmed on-chain",
    cls: "text-amber-300",
  },
  "not-attributable": {
    label: "Not attributed · creator-fee claims are not reported to POST /trades/",
    cls: "text-zinc-400",
  },
};

export function BookPanel({ onAttributionUpdate }: { onAttributionUpdate?: () => void } = {}) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const ticketRef = useRef<HTMLDivElement>(null);

  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [claimSig, setClaimSig] = useState<string | null>(null);
  const [mode, setMode] = useState<ClaimMode>("win");
  const [claimAttr, setClaimAttr] = useState<ClaimAttr>("idle");
  const [claimMarketId, setClaimMarketId] = useState("");
  const [priceByMarket, setPriceByMarket] = useState<
    Record<string, { yes: string | null; no: string | null }>
  >({});

  const load = useCallback(async () => {
    if (!publicKey) {
      setError("Connect a wallet to load positions");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await pantaFetch<PositionsResponse>("/positions/", {
        query: { wallet: publicKey.toBase58() },
      });
      const rows = data.positions || [];
      setPositions(rows);
      // Soft-fetch detail prices for notional marks (live API only)
      const ids = Array.from(new Set(rows.map((r) => r.marketId))).slice(0, 12);
      void (async () => {
        const next: Record<string, { yes: string | null; no: string | null }> = {};
        await Promise.all(
          ids.map(async (id) => {
            try {
              const { data: m } = await pantaFetch<MarketCatalogItem>(
                `/markets/${encodeURIComponent(id)}/`,
              );
              const side = impliedSide(m);
              next[id] = { yes: side.yes, no: side.no };
            } catch {
              /* skip */
            }
          }),
        );
        if (Object.keys(next).length) {
          setPriceByMarket((prev) => ({ ...prev, ...next }));
        }
      })();
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (publicKey) {
      void load();
    } else {
      setPositions([]);
      setError(null);
    }
  }, [publicKey, load]);

  const fillClaim = (marketId: string) => {
    setClaimMarketId(marketId);
    setMode("win");
    setClaimError(null);
    setClaimMsg(null);
    setClaimSig(null);
    setClaimAttr("idle");
    requestAnimationFrame(() => {
      ticketRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  /** Poll GET /account/trades/?kind=claim for the signature → "attributed". */
  const checkClaimLedger = async (sig: string) => {
    for (const delay of LEDGER_CHECK_DELAYS_MS) {
      await sleep(delay);
      try {
        const { data } = await pantaFetch<AccountTradesResponse>("/account/trades/", {
          query: { limit: "50", kind: "claim" },
        });
        if ((data.items || []).some((row) => row.signature === sig)) {
          setClaimAttr("attributed");
          onAttributionUpdate?.();
          return;
        }
      } catch {
        /* keep trying; stays "reported" */
      }
    }
  };

  const runClaim = async () => {
    setClaimBusy(true);
    setClaimError(null);
    setClaimMsg(null);
    setClaimSig(null);
    setClaimAttr("idle");
    try {
      if (!publicKey || !signTransaction) {
        throw new Error("Connect a signing wallet");
      }
      if (!claimMarketId.trim()) throw new Error("marketId required");
      const path =
        mode === "win" ? "/claim/build/" : "/claim/creator-fees/build/";
      const { data } = await pantaFetch<
        ClaimBuildResponse | CreatorFeesClaimBuildResponse
      >(path, {
        method: "POST",
        body: {
          wallet: publicKey.toBase58(),
          marketId: claimMarketId.trim(),
        },
      });
      if (!data.instructions?.length || !data.recentBlockhash) {
        throw new Error("Build returned no instructions");
      }
      if (data.wallet && data.wallet !== publicKey.toBase58()) {
        throw new Error("Claim build wallet does not match the connected wallet. Signing blocked.");
      }
      // Same pre-sign allowlist as primary buys (Panta USDC program + standard programs).
      const check = validatePantaInstructions(data.instructions, publicKey);
      if (!check.ok) throw new Error(check.reason);
      const lvbh = await resolveLastValidBlockHeight(connection, data.lastValidBlockHeight);
      const tx = instructionsToVersionedTx(
        data.instructions,
        publicKey,
        data.recentBlockhash,
      );
      assertFeePayer(tx, publicKey);
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      setClaimSig(sig);
      setClaimMsg(`Claim broadcast · ${shortAddr(sig, 6)} · confirming…`);
      const outcome = await confirmSignature(connection, sig, data.recentBlockhash, lvbh);
      if (outcome.status !== "confirmed") {
        setClaimMsg(`Claim broadcast · ${shortAddr(sig, 6)}`);
        throw new Error(outcome.message);
      }
      setClaimMsg(`Claim confirmed · ${shortAddr(sig, 6)}`);
      // Win claims are reported for attribution; creator-fee claims must not
      // be (docs: POST /trades/ returns TX_MISMATCH), so they stay unattributed.
      if (mode === "win") {
        const wallet = publicKey.toBase58();
        const marketId = claimMarketId.trim();
        setClaimAttr("reporting");
        try {
          const { data: rep } = await pantaFetch<TradeReportResponse>("/trades/", {
            method: "POST",
            body: { signature: sig, wallet, marketId },
          });
          // `processed` = attribution stored (docs trades/report); anything else is only "reported".
          const attributed = String(rep?.status || "").toLowerCase() === "processed";
          setClaimAttr(attributed ? "attributed" : "reported");
          onAttributionUpdate?.();
          if (!attributed) void checkClaimLedger(sig);
        } catch {
          setClaimAttr("report-failed");
        }
      } else {
        setClaimAttr("not-attributable");
      }
      void load();
    } catch (e) {
      setClaimError(describeErr(e));
    } finally {
      setClaimBusy(false);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-5 animate-fade-in">
      <div className="lg:col-span-3">
        <Panel
          title="Positions"
          flush
          action={
            <button
              type="button"
              disabled={busy || !connected}
              onClick={() => void load()}
              className="mr-3.5 rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200 active:scale-[0.98] disabled:opacity-40"
            >
              {busy ? "Loading…" : "Refresh"}
            </button>
          }
        >
          {!connected && (
            <div className="flex flex-col items-start gap-3 px-3.5 py-8">
              <p className="text-sm text-zinc-400">
                Connect a wallet to query positions.
              </p>
              <button
                type="button"
                onClick={() => setVisible(true)}
                className="rounded-md bg-cyan-400 px-3.5 py-2 text-[12px] font-semibold text-[#0a0a0b] transition hover:bg-cyan-300 active:scale-[0.98]"
              >
                Connect wallet
              </button>
            </div>
          )}
          {error && (
            <div className="mx-3.5 mt-3 rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          )}
          {connected && busy && positions.length === 0 && (
            <div className="space-y-2 p-3.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-10 w-full" />
              ))}
            </div>
          )}
          {connected && (positions.length > 0 || (!busy && positions.length === 0)) ? (
          <div className="overflow-x-auto">
            {positions.length > 0 ? (
            <table className="w-full text-left text-sm">
              <thead className="type-col">
                <tr className="border-b border-[#1f1f23]">
                  <th scope="col" className="px-3.5 py-2 font-medium">
                    Market
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Side
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Shares
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 font-medium"
                    title="Mark (spot × shares · not P&L)"
                  >
                    Mark
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Outcome
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Phase
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Claim
                  </th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => {
                  const claimable = Boolean(p.claimable && !p.claimed);
                  return (
                    <tr
                      key={`${p.marketId}-${p.side}-${i}`}
                      className={`border-t border-[#1f1f23] transition-colors hover:bg-[#161618] ${
                        claimable
                          ? "border-l-2 border-l-emerald-400/70 bg-emerald-500/[0.04]"
                          : ""
                      }`}
                    >
                      <td className="px-3.5 py-2.5">
                        <div className="font-medium text-zinc-200">
                          {p.title || shortAddr(p.marketId, 5)}
                        </div>
                      </td>
                      <td
                        className={`px-3 py-2.5 font-num text-xs uppercase ${
                          p.side?.toLowerCase() === "yes"
                            ? "text-emerald-400"
                            : p.side?.toLowerCase() === "no"
                              ? "text-rose-400"
                              : "text-zinc-400"
                        }`}
                      >
                        {p.side}
                      </td>
                      <td className="px-3 py-2.5 font-num text-zinc-300">
                        {p.shares}
                      </td>
                      <td className="px-3 py-2.5 font-num text-xs text-zinc-400">
                        {(() => {
                          const px = priceByMarket[p.marketId];
                          if (!px) return <span className="text-zinc-600">···</span>;
                          const side = (p.side || "").toLowerCase();
                          const price =
                            side === "yes" || side === "y"
                              ? px.yes
                              : side === "no" || side === "n"
                                ? px.no
                                : null;
                          const shares = Number(p.shares);
                          const pr = price != null && price !== "" ? Number(price) : NaN;
                          if (!Number.isFinite(shares) || !Number.isFinite(pr)) {
                            return <span className="text-zinc-600">—</span>;
                          }
                          const notional = shares * pr;
                          return (
                            <span title={`shares × ${pr.toFixed(4)}`}>
                              {notional.toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                              })}{" "}
                              USDC
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2.5 font-num text-xs text-zinc-500">
                        {p.outcome || "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <PhaseBadge phase={p.phase} />
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {p.claimed ? (
                          <span className="text-zinc-500">Claimed</span>
                        ) : claimable ? (
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-400/80">
                              Claimable
                            </span>
                            <button
                              type="button"
                              onClick={() => fillClaim(p.marketId)}
                              className="rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-500/25 active:scale-[0.98]"
                            >
                              Claim
                            </button>
                          </div>
                        ) : (
                          <span className="text-zinc-500">Open</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            ) : !busy ? (
              <div className="px-3.5 py-12 text-center text-sm text-zinc-600">
                <p className="text-zinc-400">No positions yet</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Primary buys land here after attribute
                </p>
                <Link
                  href="/desk"
                  className="mt-3 inline-flex items-center rounded-md bg-cyan-400 px-3 py-1.5 text-[12px] font-semibold text-[#0a0a0b] transition hover:bg-cyan-300"
                >
                  Browse desk →
                </Link>
              </div>
            ) : null}
          </div>
          ) : null}
        </Panel>
      </div>

      <div className="lg:col-span-2" ref={ticketRef}>
        <Panel title="Claim ticket">
          <div className="mb-3 flex gap-1.5">
            <button
              type="button"
              aria-pressed={mode === "win"}
              onClick={() => setMode("win")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition active:scale-[0.98] ${
                mode === "win"
                  ? "bg-cyan-400 text-[#0a0a0b]"
                  : "border border-[#1f1f23] text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Win claim
            </button>
            <button
              type="button"
              aria-pressed={mode === "creator-fees"}
              onClick={() => setMode("creator-fees")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition active:scale-[0.98] ${
                mode === "creator-fees"
                  ? "bg-cyan-400 text-[#0a0a0b]"
                  : "border border-[#1f1f23] text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Creator fees
            </button>
          </div>
          <p className="type-meta mb-3 rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-2.5 py-2 leading-relaxed">
            {mode === "win" ? (
              <>
                <span className="text-zinc-300">Win claims are reported for attribution.</span> After
                the claim confirms, the desk reports it with POST /trades/. It reads{" "}
                <span className="text-zinc-300">reported</span> until Panta returns{" "}
                <span className="font-num">processed</span> or the claim appears in
                /account/trades/, then <span className="text-cyan-300">attributed</span>.
              </>
            ) : (
              <>
                <span className="text-zinc-300">Creator-fee claims are not attributed.</span> Panta
                does not accept them on POST /trades/ (TX_MISMATCH), so the desk does not report
                them and they will not appear in Activity.
              </>
            )}
          </p>
          <label className="block text-[11px] text-zinc-500">
            Market ID
            <input
              value={claimMarketId}
              onChange={(e) => setClaimMarketId(e.target.value)}
              className="mt-1 w-full rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-3 py-2 text-sm outline-none focus:border-cyan-400/40"
            />
          </label>
          {claimError && (
            <div className="mt-3 rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {claimError}
            </div>
          )}
          {claimMsg && (
            <div className="mt-3 break-all rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 animate-fade-in">
              {claimMsg}
              {claimSig && (
                <a
                  href={`https://solscan.io/tx/${claimSig}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block text-cyan-300 hover:underline"
                >
                  View on Solscan →
                </a>
              )}
              {claimAttr !== "idle" && (
                <span
                  className={`mt-1.5 block border-t border-emerald-500/15 pt-1.5 text-xs ${CLAIM_ATTR_COPY[claimAttr].cls}`}
                  role="status"
                >
                  {CLAIM_ATTR_COPY[claimAttr].label}
                </span>
              )}
            </div>
          )}
          <button
            type="button"
            disabled={claimBusy || !connected || !claimMarketId.trim()}
            onClick={() => void runClaim()}
            className={`mt-4 w-full rounded-md py-2.5 text-sm font-semibold transition active:scale-[0.98] ${
              claimBusy || !connected || !claimMarketId.trim()
                ? "cursor-not-allowed border border-[#1f1f23] bg-[#161618] text-zinc-500"
                : "bg-cyan-400 text-[#0a0a0b] hover:bg-cyan-300"
            }`}
          >
            {!connected
              ? "Connect wallet to claim"
              : claimBusy
                ? "Building…"
                : "Build · sign · broadcast"}
          </button>
        </Panel>
      </div>
    </div>
  );
}
