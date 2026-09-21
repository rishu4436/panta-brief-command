"use client";

import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { pantaFetch } from "@/lib/api";
import { describeErr } from "@/lib/errors";
import { shortAddr } from "@/lib/format";
import { instructionsToVersionedTx } from "@/lib/solana";
import type {
  ClaimBuildResponse,
  CreatorFeesClaimBuildResponse,
  PositionRow,
  PositionsResponse,
} from "@/lib/types";
import { GlassCard } from "./GlassCard";
import { PhaseBadge } from "./PhaseBadge";

type ClaimMode = "win" | "creator-fees";

export function BookPanel() {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<ClaimMode>("win");
  const [claimMarketId, setClaimMarketId] = useState("");

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
      setPositions(data.positions || []);
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy(false);
    }
  }, [publicKey]);

  const runClaim = async () => {
    setClaimBusy(true);
    setClaimError(null);
    setClaimMsg(null);
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
      const tx = instructionsToVersionedTx(
        data.instructions,
        publicKey,
        data.recentBlockhash,
      );
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      setClaimMsg(`Broadcast claim ${sig}`);
      if (mode === "win") {
        try {
          await pantaFetch("/trades/", {
            method: "POST",
            body: {
              signature: sig,
              wallet: publicKey.toBase58(),
              marketId: claimMarketId.trim(),
            },
          });
          setClaimMsg((m) => `${m} · attributed via POST /trades/`);
        } catch {
          /* optional */
        }
      }
    } catch (e) {
      setClaimError(describeErr(e));
    } finally {
      setClaimBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <GlassCard
          title="Positions"
          action={
            <button
              type="button"
              disabled={busy || !connected}
              onClick={() => void load()}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] hover:bg-white/10 disabled:opacity-40"
            >
              {busy ? "Loading…" : "Refresh"}
            </button>
          }
        >
          {!connected && (
            <p className="text-sm text-amber-200/90">
              Connect a wallet to query <code>GET /positions/?wallet=</code>.
            </p>
          )}
          {error && (
            <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          )}
          <div className="overflow-hidden rounded-xl border border-white/5">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Market</th>
                  <th className="px-3 py-2">Side</th>
                  <th className="px-3 py-2">Shares</th>
                  <th className="px-3 py-2">Phase</th>
                  <th className="px-3 py-2">Claim</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => (
                  <tr
                    key={`${p.marketId}-${p.side}-${i}`}
                    className="border-t border-white/5"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-zinc-200">
                        {p.title || shortAddr(p.marketId, 5)}
                      </div>
                      <button
                        type="button"
                        className="text-[11px] text-cyan-400 hover:underline"
                        onClick={() => setClaimMarketId(p.marketId)}
                      >
                        use for claim
                      </button>
                    </td>
                    <td className="px-3 py-2 uppercase text-zinc-300">{p.side}</td>
                    <td className="px-3 py-2 text-zinc-300">{p.shares}</td>
                    <td className="px-3 py-2">
                      <PhaseBadge phase={p.phase} />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {p.claimed ? "claimed" : p.claimable ? "claimable" : "—"}
                    </td>
                  </tr>
                ))}
                {positions.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-8 text-center text-sm text-zinc-500"
                    >
                      No positions loaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>

      <div className="lg:col-span-2">
        <GlassCard title="Claim build">
          <p className="mb-3 text-xs text-zinc-400">
            Builds unsigned instructions via{" "}
            <code>POST /claim/build/</code> or{" "}
            <code>POST /claim/creator-fees/build/</code>, compiles a versioned
            tx, signs, broadcasts, and optionally attributes win claims.
          </p>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => setMode("win")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                mode === "win"
                  ? "bg-cyan-500 text-slate-950"
                  : "border border-white/10 text-zinc-400"
              }`}
            >
              Win claim
            </button>
            <button
              type="button"
              onClick={() => setMode("creator-fees")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                mode === "creator-fees"
                  ? "bg-violet-500 text-slate-950"
                  : "border border-white/10 text-zinc-400"
              }`}
            >
              Creator fees
            </button>
          </div>
          <label className="block text-xs text-zinc-400">
            Market ID
            <input
              value={claimMarketId}
              onChange={(e) => setClaimMarketId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
            />
          </label>
          {claimError && (
            <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {claimError}
            </div>
          )}
          {claimMsg && (
            <div className="mt-3 break-all rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {claimMsg}
            </div>
          )}
          <button
            type="button"
            disabled={claimBusy || !connected}
            onClick={() => void runClaim()}
            className="mt-4 w-full rounded-lg bg-gradient-to-r from-emerald-400 to-cyan-500 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
          >
            {claimBusy ? "Building…" : "Build · sign · broadcast"}
          </button>
        </GlassCard>
      </div>
    </div>
  );
}
