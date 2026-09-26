"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useInvalidateAttribution, useMarketDetails, usePositions } from "@/lib/data/hooks";
import { describeErr } from "@/lib/errors";
import { impliedSide, shortAddr } from "@/lib/format";
import { isInLedger, reportTrade } from "@/lib/panta/attribution";
import { buildClaim, isAttributableClaim } from "@/lib/panta/claims";
import type { ClaimKind } from "@/lib/panta/domain";
import { assertFeePayer, validatePantaInstructions } from "@/lib/panta/instructions";
import {
  confirmSignature,
  instructionsToVersionedTx,
  resolveLastValidBlockHeight,
} from "@/lib/solana";
import { Panel } from "./Panel";
import { PhaseBadge } from "./PhaseBadge";
import { StatusBadge } from "./ui/StatusBadge";
import { EmptyState, ErrorState, SkeletonLoader } from "./ui/States";
import { IconExternal, IconPortfolio, IconWallet } from "./ui/Icons";

export type BookTab = "positions" | "claims";

type ClaimMode = ClaimKind;
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

export function BookPanel({ tab, onTabChange }: { tab: BookTab; onTabChange: (t: BookTab) => void }) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const ticketRef = useRef<HTMLDivElement>(null);

  const wallet = connected && publicKey ? publicKey.toBase58() : null;
  const positionsQ = usePositions(wallet);
  const positions = positionsQ.data ?? [];
  const busy = positionsQ.isFetching;
  const error = positionsQ.error ? describeErr(positionsQ.error) : null;
  const load = () => void positionsQ.refetch();
  const onAttributionUpdate = useInvalidateAttribution();

  // Marks: detail prices via the shared market cache. Intentional bounded
  // hydration (≤12 markets, ≤4 in flight) — see useMarketDetails.
  const details = useMarketDetails(positions.map((p) => p.marketId));
  const priceByMarket: Record<string, { yes: string | null; no: string | null }> = {};
  for (const [id, m] of details) priceByMarket[id] = impliedSide(m);

  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [claimSig, setClaimSig] = useState<string | null>(null);
  const [mode, setMode] = useState<ClaimMode>("win");
  const [claimAttr, setClaimAttr] = useState<ClaimAttr>("idle");
  const [claimMarketId, setClaimMarketId] = useState("");
  const [claimPhase, setClaimPhase] = useState<"idle" | "confirming" | "pending" | "confirmed" | "failed">("idle");

  const fillClaim = (marketId: string) => {
    setClaimMarketId(marketId);
    setMode("win");
    setClaimError(null);
    setClaimMsg(null);
    setClaimSig(null);
    setClaimAttr("idle");
    onTabChange("claims");
    requestAnimationFrame(() => {
      ticketRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  /** Poll GET /account/trades/?kind=claim for the signature → "attributed". */
  const checkClaimLedger = async (sig: string) => {
    for (const delay of LEDGER_CHECK_DELAYS_MS) {
      await sleep(delay);
      try {
        if (await isInLedger(sig, "claim")) {
          setClaimAttr("attributed");
          onAttributionUpdate();
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
    setClaimPhase("idle");
    try {
      if (!publicKey || !signTransaction) {
        throw new Error("Connect a signing wallet");
      }
      if (!claimMarketId.trim()) throw new Error("marketId required");
      // Parsed strictly (zod) by the claims adapter before anything is signed.
      const data = await buildClaim(mode, {
        wallet: publicKey.toBase58(),
        marketId: claimMarketId.trim(),
      });
      if (!data.instructions.length) {
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
      setClaimPhase("confirming");
      setClaimMsg(`Claim broadcast · ${shortAddr(sig, 6)} · confirming…`);
      const outcome = await confirmSignature(connection, sig, data.recentBlockhash, lvbh);
      if (outcome.status !== "confirmed") {
        setClaimPhase(outcome.status === "pending" ? "pending" : "failed");
        setClaimMsg(`Claim broadcast · ${shortAddr(sig, 6)}`);
        throw new Error(outcome.message);
      }
      setClaimPhase("confirmed");
      setClaimMsg(`Claim confirmed · ${shortAddr(sig, 6)}`);
      // Win claims are reported for attribution; creator-fee claims must not
      // be (docs: POST /trades/ returns TX_MISMATCH), so they stay unattributed.
      if (isAttributableClaim(mode)) {
        setClaimAttr("reporting");
        try {
          const { state } = await reportTrade({
            signature: sig,
            wallet: publicKey.toBase58(),
            marketId: claimMarketId.trim(),
          });
          // `processed` = attribution stored (docs trades/report); anything else is only "reported".
          setClaimAttr(state);
          onAttributionUpdate();
          if (state !== "attributed") void checkClaimLedger(sig);
        } catch {
          setClaimAttr("report-failed");
        }
      } else {
        setClaimAttr("not-attributable");
      }
      load();
    } catch (e) {
      setClaimError(describeErr(e));
    } finally {
      setClaimBusy(false);
    }
  };

  const claimRows = positions.filter((p) => p.claimable || p.claimed);

  const notConnected = (
    <EmptyState
      icon={<IconWallet className="h-5 w-5" />}
      title="Connect a wallet to see your book"
      description="Positions and claims are read for the connected Solana wallet. Nothing is signed until you approve it."
      action={
        <button type="button" onClick={() => setVisible(true)} className="btn btn-primary">
          Connect Wallet
        </button>
      }
    />
  );

  const errorBox = error ? (
    <ErrorState
      className="m-4"
      title="Couldn't load positions"
      description={`${error}. Panta may be busy; try again in a moment.`}
      onRetry={load}
    />
  ) : null;

  const refresh = (
    <button type="button" disabled={busy || !connected} onClick={load} className="btn btn-ghost btn-sm mr-2">
      {busy ? "Loading…" : "Refresh"}
    </button>
  );

  const statusFor = (p: (typeof positions)[number]) =>
    p.claimed ? (
      <StatusBadge tone="success" size="xs">
        Claimed
      </StatusBadge>
    ) : p.claimable ? (
      <StatusBadge tone="live" size="xs">
        Claimable
      </StatusBadge>
    ) : (
      <PhaseBadge phase={p.phase} />
    );

  if (tab === "positions") {
    return (
      <Panel title="Positions" icon={<IconPortfolio className="h-4 w-4" />} flush action={refresh}>
        {!connected ? (
          notConnected
        ) : (
          <>
            {errorBox}
            {busy && positions.length === 0 ? (
              <SkeletonLoader rows={4} className="p-4" label="Loading positions" />
            ) : positions.length === 0 && !error ? (
              <EmptyState
                title="No positions yet"
                description="Buys you make on the desk appear here once Panta records them."
                action={
                  <Link href="/desk" className="btn btn-primary">
                    Browse markets
                  </Link>
                }
              />
            ) : positions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[13px]">
                  <thead className="type-col">
                    <tr className="border-b border-line">
                      <th scope="col" className="px-4 py-2.5 font-medium">Market</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Side</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Shares</th>
                      <th scope="col" className="px-3 py-2.5 font-medium" title="Spot price × shares. Not P&L.">
                        Mark value
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Outcome</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p, i) => {
                      const claimable = Boolean(p.claimable && !p.claimed);
                      const px = priceByMarket[p.marketId];
                      const price = px ? (p.side === "yes" ? px.yes : p.side === "no" ? px.no : null) : null;
                      const shares = p.sharesNum ?? NaN;
                      const pr = price != null && price !== "" ? Number(price) : NaN;
                      const mark = Number.isFinite(shares) && Number.isFinite(pr) ? shares * pr : null;
                      return (
                        <tr key={`${p.marketId}-${p.side}-${i}`} className="border-t border-line transition-colors hover:bg-elevated/60">
                          <td className="px-4 py-3">
                            <Link href={`/markets/${p.marketId}`} className="font-medium text-ink hover:text-cyan-200">
                              {p.title || shortAddr(p.marketId, 5)}
                            </Link>
                          </td>
                          <td className={`px-3 py-3 font-semibold uppercase ${p.side === "yes" ? "text-emerald-300" : p.side === "no" ? "text-rose-300" : "text-ink-3"}`}>
                            {p.side ?? "—"}
                          </td>
                          <td className="font-num px-3 py-3 text-ink-2">{p.shares}</td>
                          <td className="font-num px-3 py-3 text-ink-2">
                            {!px ? (
                              <span className="text-ink-3">…</span>
                            ) : mark == null ? (
                              <span className="text-ink-3">—</span>
                            ) : (
                              <span title={`shares × ${pr.toFixed(4)}`}>{mark.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC</span>
                            )}
                          </td>
                          <td className="font-num px-3 py-3 text-ink-3">{p.outcome || "—"}</td>
                          <td className="px-3 py-3">{statusFor(p)}</td>
                          <td className="px-4 py-3 text-right">
                            {claimable ? (
                              <button type="button" onClick={() => fillClaim(p.marketId)} className="btn btn-secondary btn-sm">
                                Claim
                              </button>
                            ) : (
                              <span className="text-ink-3">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="border-t border-line px-4 py-2.5 text-[11px] text-ink-3">
                  Mark value = spot price × shares, not profit and loss.
                </p>
              </div>
            ) : null}
          </>
        )}
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
      <Panel title="Claims" flush action={refresh}>
        {!connected ? (
          notConnected
        ) : (
          <>
            {errorBox}
            {busy && positions.length === 0 ? (
              <SkeletonLoader rows={3} className="p-4" label="Loading claims" />
            ) : claimRows.length === 0 && !error ? (
              <EmptyState
                title="Nothing to claim yet"
                description="When a market you hold resolves in your favour, the position shows up here as Claimable."
              />
            ) : (
              <ul className="divide-y divide-line">
                {claimRows.map((p, i) => (
                  <li key={`${p.marketId}-${i}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">{p.title || shortAddr(p.marketId, 5)}</p>
                      <p className="font-num mt-0.5 text-[12px] text-ink-3">
                        <span className={p.side === "yes" ? "text-emerald-300" : "text-rose-300"}>{(p.side || "").toUpperCase() || "—"}</span> ·{" "}
                        {p.shares} shares
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusFor(p)}
                      {p.claimable && !p.claimed ? (
                        <button type="button" onClick={() => fillClaim(p.marketId)} className="btn btn-secondary btn-sm">
                          Claim
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>

      <div ref={ticketRef} className="scroll-mt-20">
        <Panel title="Claim ticket">
          <div className="segmented flex w-full" role="group" aria-label="Claim type">
            <button type="button" className="flex-1" aria-pressed={mode === "win"} onClick={() => setMode("win")}>
              Win claim
            </button>
            <button type="button" className="flex-1" aria-pressed={mode === "creator-fees"} onClick={() => setMode("creator-fees")}>
              Creator fees
            </button>
          </div>
          <p className="mt-3 rounded-xl border border-line bg-inset px-3 py-2.5 text-[12px] leading-relaxed text-ink-3">
            {mode === "win" ? (
              <>
                <span className="text-ink-2">Win claims are reported for attribution.</span> After the claim confirms, the
                desk reports it with POST /trades/. It reads <span className="text-ink-2">reported</span> until Panta returns{" "}
                <span className="font-addr">processed</span> or the claim appears in /account/trades/, then{" "}
                <span className="text-cyan-300">attributed</span>.
              </>
            ) : (
              <>
                <span className="text-ink-2">Creator-fee claims are not attributed.</span> Panta does not accept them on POST
                /trades/ (TX_MISMATCH), so the desk does not report them and they will not appear in Activity.
              </>
            )}
          </p>
          <label className="mt-3 block text-[12px] text-ink-3">
            Market ID
            <input value={claimMarketId} onChange={(e) => setClaimMarketId(e.target.value)} className="field mt-1 font-addr" placeholder="Pick Claim on a position, or paste an ID" />
          </label>
          {claimError && (
            <div role="alert" className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[13px] text-rose-100">
              {claimError}
            </div>
          )}
          {claimMsg && (
            <div className="mt-3 space-y-2 rounded-xl border border-line bg-inset px-3 py-2.5 text-[13px] animate-fade-in" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ink-2">Transaction</span>
                <StatusBadge
                  tone={claimPhase === "confirmed" ? "success" : claimPhase === "failed" ? "error" : "pending"}
                  size="xs"
                >
                  {claimPhase === "confirmed" ? "Confirmed" : claimPhase === "failed" ? "Failed" : claimPhase === "pending" ? "Pending" : "Submitted"}
                </StatusBadge>
              </div>
              <p className="break-all text-[12px] text-ink-3">{claimMsg}</p>
              {claimSig && (
                <a href={`https://solscan.io/tx/${claimSig}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-cyan-300 hover:underline">
                  View on Solscan <IconExternal className="h-3 w-3" />
                </a>
              )}
              {claimAttr !== "idle" && (
                <p className={`border-t border-line pt-2 text-[12px] ${CLAIM_ATTR_COPY[claimAttr].cls}`} role="status">
                  <span className="text-ink-3">Attribution: </span>
                  {CLAIM_ATTR_COPY[claimAttr].label}
                </p>
              )}
            </div>
          )}
          {!connected ? (
            <button type="button" onClick={() => setVisible(true)} className="btn btn-primary btn-lg mt-4 w-full">
              Connect Wallet to claim
            </button>
          ) : (
            <button type="button" disabled={claimBusy || !claimMarketId.trim()} onClick={() => void runClaim()} className="btn btn-primary btn-lg mt-4 w-full">
              {claimBusy ? "Building & waiting for wallet…" : "Build, sign & broadcast claim"}
            </button>
          )}
          <p className="mt-2 text-[11px] text-ink-3">Your wallet signs the claim. Instructions are checked against the allowlist first.</p>
        </Panel>
      </div>
    </div>
  );
}
