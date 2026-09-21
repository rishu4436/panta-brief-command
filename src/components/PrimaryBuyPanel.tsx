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
import { Panel } from "./Panel";

const STEPS = [
  "Quote",
  "Build",
  "Sign",
  "Submit",
  "Verify",
  "Attr",
] as const;

export function PrimaryBuyPanel({
  initialMarketId = "",
  compact = false,
}: {
  initialMarketId?: string;
  compact?: boolean;
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

  const inputCls =
    "mt-1 w-full rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400/40";
  const btnPrimary =
    "rounded-md bg-cyan-400 px-3 py-2 text-sm font-semibold text-[#0a0a0b] transition hover:bg-cyan-300 disabled:opacity-40";
  const btnGhost =
    "rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-3 py-2 text-sm text-zinc-300 transition hover:border-[#2a2a2e] hover:text-zinc-100 disabled:opacity-40";

  return (
    <Panel title={compact ? "Execute ticket" : "Primary buy"}>
      <div className="mb-3 flex flex-wrap gap-1">
        {STEPS.map((label, i) => (
          <span
            key={label}
            className={`rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
              step > i
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                : step === i
                  ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
                  : "border-[#1f1f23] text-zinc-600"
            }`}
          >
            {i + 1}.{label}
          </span>
        ))}
      </div>

      <div className={`grid gap-2.5 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
        <label className={`block text-[11px] text-zinc-500 ${compact ? "" : "sm:col-span-2"}`}>
          Market ID
          <input
            value={marketId}
            onChange={(e) => setMarketId(e.target.value)}
            className={inputCls}
          />
        </label>

        <div className={compact ? "" : ""}>
          <div className="text-[11px] text-zinc-500">Side</div>
          <div className="mt-1 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setSide("yes")}
              className={`rounded-md border py-2 text-sm font-semibold transition ${
                side === "yes"
                  ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                  : "border-[#1f1f23] text-zinc-500 hover:border-[#2a2a2e]"
              }`}
            >
              YES
            </button>
            <button
              type="button"
              onClick={() => setSide("no")}
              className={`rounded-md border py-2 text-sm font-semibold transition ${
                side === "no"
                  ? "border-rose-400/40 bg-rose-500/15 text-rose-300"
                  : "border-[#1f1f23] text-zinc-500 hover:border-[#2a2a2e]"
              }`}
            >
              NO
            </button>
          </div>
        </div>

        <label className="block text-[11px] text-zinc-500">
          Amount (USDC)
          <input
            value={amountUsdc}
            onChange={(e) => setAmountUsdc(e.target.value)}
            className={`${inputCls} font-num`}
          />
        </label>
        <label className="block text-[11px] text-zinc-500">
          Max slippage (bps)
          <input
            type="number"
            value={maxSlippageBps}
            onChange={(e) => setMaxSlippageBps(Number(e.target.value))}
            className={`${inputCls} font-num`}
          />
        </label>
        {!compact && (
          <label className="block text-[11px] text-zinc-500 sm:col-span-2">
            Attribution userId (optional)
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className={inputCls}
            />
          </label>
        )}
      </div>

      {quote && (
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-md border border-cyan-400/20 bg-cyan-400/[0.04] p-2.5 text-[11px] sm:grid-cols-4">
          <div>
            <div className="text-zinc-600">Shares</div>
            <div className="font-num font-semibold text-cyan-300">{quote.shares}</div>
          </div>
          <div>
            <div className="text-zinc-600">Avg</div>
            <div className="font-num font-semibold text-cyan-300">{quote.avgPrice}</div>
          </div>
          <div>
            <div className="text-zinc-600">Fee</div>
            <div className="font-num font-semibold text-cyan-300">{quote.feeUsdc}</div>
          </div>
          <div>
            <div className="text-zinc-600">Expires</div>
            <div className="font-num font-semibold text-cyan-300">
              {new Date(quote.expiresAt).toLocaleTimeString()}
            </div>
          </div>
        </div>
      )}

      {signature && (
        <p className="mt-2 break-all font-num text-[10px] text-zinc-500">
          sig <span className="text-emerald-400">{signature}</span>
        </p>
      )}

      {error && (
        <div className="mt-2 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      <div className={`mt-3 flex flex-wrap gap-1.5 ${compact ? "flex-col" : ""}`}>
        <button type="button" disabled={busy} onClick={() => void runQuote()} className={btnPrimary}>
          1 · Quote
        </button>
        <button type="button" disabled={busy || !quote} onClick={() => void runBuild()} className={btnGhost}>
          2 · Build VT
        </button>
        <button type="button" disabled={busy || !build} onClick={() => void runSignBroadcast()} className={btnGhost}>
          3 · Sign & send
        </button>
        <button type="button" disabled={busy || !signature} onClick={() => void runSubmit()} className={btnGhost}>
          4 · Submit
        </button>
        <button type="button" disabled={busy || !build} onClick={() => void runVerify()} className={btnGhost}>
          5 · Verify
        </button>
        <button
          type="button"
          disabled={busy || !signature}
          onClick={() => void runAttribute()}
          className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 disabled:opacity-40"
        >
          6 · POST /trades/
        </button>
      </div>

      {!connected && (
        <p className="mt-2 text-[11px] text-amber-400/90">
          Connect Phantom or Solflare before quoting.
        </p>
      )}

      {!compact && (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          <div className="rounded-md border border-[#1f1f23] bg-[#0a0a0b] p-2.5">
            <div className="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-600">
              Desk log
            </div>
            <ul className="max-h-36 space-y-1 overflow-y-auto font-num text-[10px] text-zinc-500">
              {log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
              {log.length === 0 && <li>Idle — run Quote to open a session.</li>}
            </ul>
          </div>
          <div className="rounded-md border border-[#1f1f23] bg-[#0a0a0b] p-2.5">
            <div className="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-600">
              Last responses
            </div>
            <pre className="max-h-36 overflow-auto font-num text-[9px] text-zinc-600">
              {JSON.stringify(
                { submitRaw, verifyRaw, tradeRaw, orderId: build?.orderId },
                null,
                2,
              )}
            </pre>
          </div>
        </div>
      )}
    </Panel>
  );
}
