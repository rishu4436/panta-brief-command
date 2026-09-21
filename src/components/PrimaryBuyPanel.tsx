"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { pantaFetch } from "@/lib/api";
import { describeErr } from "@/lib/errors";
import { instructionsToVersionedTx } from "@/lib/solana";
import type {
  Json,
  PrimaryBuildResponse,
  PrimaryQuoteResponse,
  TradeReportResponse,
} from "@/lib/types";
import { GlassCard } from "./GlassCard";

const STEPS = [
  "Quote",
  "Build",
  "Sign & broadcast",
  "Submit",
  "Verify",
  "Attribute",
] as const;

export function PrimaryBuyPanel({
  initialMarketId = "",
}: {
  initialMarketId?: string;
}) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const [marketId, setMarketId] = useState(initialMarketId);
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amountUsdc, setAmountUsdc] = useState("20.00");
  const [maxSlippageBps, setMaxSlippageBps] = useState(100);
  const [userId, setUserId] = useState("");

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const [quote, setQuote] = useState<PrimaryQuoteResponse | null>(null);
  const [build, setBuild] = useState<PrimaryBuildResponse | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [submitRaw, setSubmitRaw] = useState<Json>(null);
  const [verifyRaw, setVerifyRaw] = useState<Json>(null);
  const [tradeRaw, setTradeRaw] = useState<Json>(null);

  useEffect(() => {
    if (initialMarketId) setMarketId(initialMarketId);
  }, [initialMarketId]);

  const push = (msg: string) =>
    setLog((prev) =>
      [`${new Date().toLocaleTimeString()}  ${msg}`, ...prev].slice(0, 40),
    );

  const requireReady = () => {
    if (!connected || !publicKey) throw new Error("Connect a Solana wallet");
    if (!signTransaction) throw new Error("Wallet cannot sign transactions");
  };

  const attributionUserId = userId.trim() || undefined;

  const runQuote = async () => {
    setBusy(true);
    setError(null);
    try {
      requireReady();
      if (!marketId.trim()) throw new Error("marketId required");
      const body: Record<string, string> = {
        wallet: publicKey!.toBase58(),
        marketId: marketId.trim(),
        side,
        amountUsdc,
      };
      if (attributionUserId) body.userId = attributionUserId;
      const { data } = await pantaFetch<PrimaryQuoteResponse>(
        "/primaryorderquote/",
        { method: "POST", userId: attributionUserId, body },
      );
      setQuote(data);
      setBuild(null);
      setSignature(null);
      setSubmitRaw(null);
      setVerifyRaw(null);
      setTradeRaw(null);
      setStep(1);
      push(
        `Quoted ${data.side.toUpperCase()} · ${data.shares} shares @ avg ${data.avgPrice} (fee ${data.feeUsdc})`,
      );
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy(false);
    }
  };

  const runBuild = async () => {
    setBusy(true);
    setError(null);
    try {
      requireReady();
      if (!quote?.quoteId) throw new Error("Quote first");
      const body: Record<string, string | number> = {
        quoteId: quote.quoteId,
        wallet: publicKey!.toBase58(),
        maxSlippageBps: Number(maxSlippageBps),
      };
      if (attributionUserId) body.userId = attributionUserId;
      const { data } = await pantaFetch<PrimaryBuildResponse>(
        "/primaryorderbuild/",
        { method: "POST", userId: attributionUserId, body },
      );
      setBuild(data);
      setSignature(null);
      setSubmitRaw(null);
      setVerifyRaw(null);
      setTradeRaw(null);
      setStep(2);
      push(
        `Built order ${data.orderId} · ${data.instructions?.length || 0} ix`,
      );
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy(false);
    }
  };

  const runSignBroadcast = async () => {
    setBusy(true);
    setError(null);
    try {
      requireReady();
      if (!build?.instructions?.length || !build.recentBlockhash) {
        throw new Error("Build first");
      }
      const tx = instructionsToVersionedTx(
        build.instructions,
        publicKey!,
        build.recentBlockhash,
      );
      const signed = await signTransaction!(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      setSignature(sig);
      setStep(3);
      push(`Broadcast ${sig.slice(0, 16)}…`);
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy(false);
    }
  };

  const runSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      requireReady();
      if (!build?.orderId || !signature) {
        throw new Error("Need orderId + signature");
      }
      const { raw } = await pantaFetch<Json>("/primaryordersubmit/", {
        method: "POST",
        body: {
          orderId: build.orderId,
          signature,
          wallet: publicKey!.toBase58(),
        },
      });
      setSubmitRaw(raw);
      setStep(4);
      push("Submitted signature to Panta");
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy(false);
    }
  };

  const runVerify = async () => {
    setBusy(true);
    setError(null);
    try {
      requireReady();
      if (!build?.orderId) throw new Error("Build first");
      const { raw } = await pantaFetch<Json>("/primaryorderverify/", {
        method: "POST",
        body: {
          orderId: build.orderId,
          signature,
          wallet: publicKey!.toBase58(),
        },
      });
      setVerifyRaw(raw);
      setStep((s) => Math.max(s, 5));
      push("Verify polled");
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy(false);
    }
  };

  const runAttribute = async () => {
    setBusy(true);
    setError(null);
    try {
      requireReady();
      if (!signature || !build) throw new Error("Need broadcast signature");
      const body: Record<string, string> = {
        signature,
        wallet: publicKey!.toBase58(),
        marketId: build.marketId,
        quoteId: build.quoteId,
        clientOrderId: build.orderId,
      };
      if (attributionUserId) body.userId = attributionUserId;
      const { data, raw } = await pantaFetch<TradeReportResponse>("/trades/", {
        method: "POST",
        userId: attributionUserId,
        body,
      });
      setTradeRaw(raw);
      setStep(6);
      push(`Attributed trade · status ${data.status}`);
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard title="Primary buy · quote → attribute">
      <div className="mb-4 flex flex-wrap gap-1.5">
        {STEPS.map((label, i) => (
          <span
            key={label}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
              step > i
                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
                : step === i
                  ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-200"
                  : "border-white/10 text-zinc-500"
            }`}
          >
            {i + 1}. {label}
          </span>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-zinc-400 sm:col-span-2">
          Market ID
          <input
            value={marketId}
            onChange={(e) => setMarketId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none ring-cyan-400/40 focus:ring"
          />
        </label>
        <label className="block text-xs text-zinc-400">
          Side
          <select
            value={side}
            onChange={(e) => setSide(e.target.value as "yes" | "no")}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          >
            <option value="yes">YES</option>
            <option value="no">NO</option>
          </select>
        </label>
        <label className="block text-xs text-zinc-400">
          Amount (USDC)
          <input
            value={amountUsdc}
            onChange={(e) => setAmountUsdc(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs text-zinc-400">
          Max slippage (bps)
          <input
            type="number"
            value={maxSlippageBps}
            onChange={(e) => setMaxSlippageBps(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs text-zinc-400">
          Attribution userId (optional)
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
        </label>
      </div>

      {quote && (
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-3 text-xs sm:grid-cols-4">
          <div>
            <div className="text-zinc-500">Shares</div>
            <div className="font-semibold text-cyan-200">{quote.shares}</div>
          </div>
          <div>
            <div className="text-zinc-500">Avg price</div>
            <div className="font-semibold text-cyan-200">{quote.avgPrice}</div>
          </div>
          <div>
            <div className="text-zinc-500">Fee</div>
            <div className="font-semibold text-cyan-200">{quote.feeUsdc}</div>
          </div>
          <div>
            <div className="text-zinc-500">Expires</div>
            <div className="font-semibold text-cyan-200">
              {new Date(quote.expiresAt).toLocaleTimeString()}
            </div>
          </div>
        </div>
      )}

      {signature && (
        <p className="mt-3 break-all text-xs text-zinc-400">
          Signature: <span className="text-emerald-300">{signature}</span>
        </p>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void runQuote()}
          className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
        >
          1 · Quote
        </button>
        <button
          type="button"
          disabled={busy || !quote}
          onClick={() => void runBuild()}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm disabled:opacity-40"
        >
          2 · Build VT
        </button>
        <button
          type="button"
          disabled={busy || !build}
          onClick={() => void runSignBroadcast()}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm disabled:opacity-40"
        >
          3 · Sign & send
        </button>
        <button
          type="button"
          disabled={busy || !signature}
          onClick={() => void runSubmit()}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm disabled:opacity-40"
        >
          4 · Submit
        </button>
        <button
          type="button"
          disabled={busy || !build}
          onClick={() => void runVerify()}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm disabled:opacity-40"
        >
          5 · Verify
        </button>
        <button
          type="button"
          disabled={busy || !signature}
          onClick={() => void runAttribute()}
          className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 disabled:opacity-40"
        >
          6 · POST /trades/
        </button>
      </div>

      {!connected && (
        <p className="mt-3 text-xs text-amber-300/90">
          Connect Phantom or Solflare before quoting.
        </p>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-white/5 bg-black/25 p-3">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">
            Desk log
          </div>
          <ul className="max-h-40 space-y-1 overflow-y-auto font-mono text-[11px] text-zinc-400">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
            {log.length === 0 && <li>Idle — run Quote to open a session.</li>}
          </ul>
        </div>
        <div className="rounded-xl border border-white/5 bg-black/25 p-3">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">
            Last responses
          </div>
          <pre className="max-h-40 overflow-auto text-[10px] text-zinc-500">
            {JSON.stringify(
              { submitRaw, verifyRaw, tradeRaw, orderId: build?.orderId },
              null,
              2,
            )}
          </pre>
        </div>
      </div>
    </GlassCard>
  );
}
