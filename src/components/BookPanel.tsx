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
import { Panel } from "./Panel";
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
              className="mr-3.5 rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
            >
              {busy ? "Loading…" : "Refresh"}
            </button>
          }
        >
          {!connected && (
            <p className="px-3.5 py-4 text-sm text-amber-400/90">
              Connect a wallet to query positions.
            </p>
          )}
          {error && (
            <div className="mx-3.5 mt-3 rounded-md border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-zinc-600">
                <tr className="border-b border-[#1f1f23]">
                  <th className="px-3.5 py-2 font-medium">Market</th>
                  <th className="px-3 py-2 font-medium">Side</th>
                  <th className="px-3 py-2 font-medium">Shares</th>
                  <th className="px-3 py-2 font-medium">Phase</th>
                  <th className="px-3 py-2 font-medium">Claim</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => (
                  <tr
                    key={`${p.marketId}-${p.side}-${i}`}
                    className="border-t border-[#1f1f23] transition-colors hover:bg-[#161618]"
                  >
                    <td className="px-3.5 py-2.5">
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
                    <td className="px-3 py-2.5 font-num text-zinc-300">{p.shares}</td>
                    <td className="px-3 py-2.5">
                      <PhaseBadge phase={p.phase} />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-zinc-500">
                      {p.claimed ? "claimed" : p.claimable ? "claimable" : "—"}
                    </td>
                  </tr>
                ))}
                {positions.length === 0 && connected && !busy && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3.5 py-12 text-center text-sm text-zinc-600"
                    >
                      No positions yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="lg:col-span-2">
        <Panel title="Claim ticket">
          <div className="mb-3 flex gap-1.5">
            <button
              type="button"
              onClick={() => setMode("win")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                mode === "win"
                  ? "bg-cyan-400 text-[#0a0a0b]"
                  : "border border-[#1f1f23] text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Win claim
            </button>
            <button
              type="button"
              onClick={() => setMode("creator-fees")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                mode === "creator-fees"
                  ? "bg-cyan-400 text-[#0a0a0b]"
                  : "border border-[#1f1f23] text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Creator fees
            </button>
          </div>
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
            <div className="mt-3 break-all rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {claimMsg}
            </div>
          )}
          <button
            type="button"
            disabled={claimBusy || !connected}
            onClick={() => void runClaim()}
            className="mt-4 w-full rounded-md bg-cyan-400 py-2.5 text-sm font-semibold text-[#0a0a0b] transition hover:bg-cyan-300 disabled:opacity-40"
          >
            {claimBusy ? "Building…" : "Build · sign · broadcast"}
          </button>
        </Panel>
      </div>
    </div>
  );
}
