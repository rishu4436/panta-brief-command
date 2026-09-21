"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { pantaFetch } from "@/lib/api";
import { describeErr } from "@/lib/errors";
import { marketLabel, shortAddr } from "@/lib/format";
import { instructionsToVersionedTx } from "@/lib/solana";
import type {
  Json,
  MarketCatalogItem,
  MarketsListResponse,
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

const AMOUNT_PRESETS = ["10", "25", "50", "100"] as const;

function countdownLabel(expiresAt: string, now: number): string {
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return "—";
  const sec = Math.max(0, Math.floor((end - now) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PrimaryBuyPanel({
  initialMarketId = "",
  compact = false,
}: {
  initialMarketId?: string;
  compact?: boolean;
}) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();

  const [marketId, setMarketId] = useState(initialMarketId);
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amountUsdc, setAmountUsdc] = useState("25");
  const [maxSlippageBps, setMaxSlippageBps] = useState(100);
  const [userId, setUserId] = useState("");
  const [mode, setMode] = useState<"guided" | "manual">("guided");

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [guidedPhase, setGuidedPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [catalog, setCatalog] = useState<MarketCatalogItem[]>([]);
  const [pickerQuery, setPickerQuery] = useState("");

  const [quote, setQuote] = useState<PrimaryQuoteResponse | null>(null);
  const [build, setBuild] = useState<PrimaryBuildResponse | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [submitRaw, setSubmitRaw] = useState<Json>(null);
  const [verifyRaw, setVerifyRaw] = useState<Json>(null);
  const [tradeRaw, setTradeRaw] = useState<Json>(null);

  useEffect(() => {
    if (initialMarketId) setMarketId(initialMarketId);
  }, [initialMarketId]);

  const loadCatalog = useCallback(async () => {
    try {
      const { data } = await pantaFetch<MarketsListResponse>("/markets/", {
        query: { status: "primary", limit: "40" },
      });
      const items = (data.items || []).slice(0, 24);
      setCatalog(items);
      const need = items.filter((m) => !(m.title || "").trim());
      const updates = new Map<string, string>();
      await Promise.all(
        need.slice(0, 16).map(async (m) => {
          try {
            const { data: det } = await pantaFetch<MarketCatalogItem>(
              `/markets/${encodeURIComponent(m.marketId)}/`,
            );
            const title = (det.title || det.description || "").trim();
            if (title) updates.set(m.marketId, title);
          } catch {
            /* ignore */
          }
        }),
      );
      if (updates.size) {
        setCatalog((prev) =>
          prev.map((m) =>
            updates.has(m.marketId) ? { ...m, title: updates.get(m.marketId)! } : m,
          ),
        );
      }
    } catch {
      /* optional picker */
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!quote?.expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [quote?.expiresAt]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

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
    return data;
  };

  const runBuild = async (q?: PrimaryQuoteResponse) => {
    requireReady();
    const qid = (q || quote)?.quoteId;
    if (!qid) throw new Error("Quote first");
    const body: Record<string, string | number> = {
      quoteId: qid,
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
    push(`Built order ${data.orderId} · ${data.instructions?.length || 0} ix`);
    return data;
  };

  const runSignBroadcast = async (b?: PrimaryBuildResponse) => {
    requireReady();
    const built = b || build;
    if (!built?.instructions?.length || !built.recentBlockhash) {
      throw new Error("Build first");
    }
    const tx = instructionsToVersionedTx(
      built.instructions,
      publicKey!,
      built.recentBlockhash,
    );
    const signed = await signTransaction!(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    setSignature(sig);
    setStep(3);
    push(`Broadcast ${sig.slice(0, 16)}…`);
    return sig;
  };

  const runSubmit = async () => {
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
  };

  const runVerify = async () => {
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
  };

  const runAttribute = async () => {
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
    setToast(`Attributed · ${shortAddr(signature, 6)}`);
  };

  const runGuided = async () => {
    setBusy(true);
    setError(null);
    try {
      setGuidedPhase("Quoting…");
      const q = await runQuote();
      setGuidedPhase("Building VT…");
      const b = await runBuild(q);
      setGuidedPhase("Sign in wallet…");
      await runSignBroadcast(b);
      setGuidedPhase(null);
      push("Guided path ready — Submit / Verify / Attribute next");
    } catch (e) {
      setError(describeErr(e));
      setGuidedPhase(null);
    } finally {
      setBusy(false);
    }
  };

  const runFinishAttribution = async () => {
    setBusy(true);
    setError(null);
    try {
      setGuidedPhase("Submitting…");
      await runSubmit();
      setGuidedPhase("Verifying…");
      await runVerify();
      setGuidedPhase("Attributing…");
      await runAttribute();
      setGuidedPhase(null);
    } catch (e) {
      setError(describeErr(e));
      setGuidedPhase(null);
    } finally {
      setBusy(false);
    }
  };

  const wrap = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy(false);
    }
  };

  const filteredCatalog = useMemo(() => {
    const qq = pickerQuery.trim().toLowerCase();
    if (!qq) return catalog;
    return catalog.filter((m) => {
      const label = marketLabel(m).toLowerCase();
      return (
        label.includes(qq) ||
        m.marketId.toLowerCase().includes(qq) ||
        (m.category || "").toLowerCase().includes(qq)
      );
    });
  }, [catalog, pickerQuery]);

  const expiresLabel = useMemo(
    () => (quote?.expiresAt ? countdownLabel(quote.expiresAt, now) : null),
    [quote?.expiresAt, now],
  );

  const inputCls =
    "mt-1 w-full rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400/40";
  const btnPrimary =
    "rounded-md bg-cyan-400 px-3 py-2.5 text-sm font-semibold text-[#0a0a0b] transition hover:bg-cyan-300 active:scale-[0.98] disabled:opacity-40";
  const btnGhost =
    "rounded-md border border-[#1f1f23] bg-[#0a0a0b] px-3 py-2 text-sm text-zinc-300 transition hover:border-[#2a2a2e] hover:text-zinc-100 active:scale-[0.98] disabled:opacity-40";

  const copySig = async () => {
    if (!signature) return;
    try {
      await navigator.clipboard.writeText(signature);
      setToast("Signature copied");
    } catch {
      /* ignore */
    }
  };

  return (
    <Panel title={compact ? "Execute ticket" : "Primary buy"}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="list" aria-label="Execute steps">
          {STEPS.map((label, i) => (
            <span
              key={label}
              role="listitem"
              aria-current={step === i ? "step" : undefined}
              className={`step-chip rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide transition-all duration-300 ${
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
        <div className="inline-flex rounded-md border border-[#1f1f23] bg-[#0a0a0b] p-0.5">
          <button
            type="button"
            aria-pressed={mode === "guided"}
            onClick={() => setMode("guided")}
            className={`rounded px-2 py-0.5 text-[10px] ${
              mode === "guided" ? "bg-[#161618] text-zinc-100" : "text-zinc-500"
            }`}
          >
            Guided
          </button>
          <button
            type="button"
            aria-pressed={mode === "manual"}
            onClick={() => setMode("manual")}
            className={`rounded px-2 py-0.5 text-[10px] ${
              mode === "manual" ? "bg-[#161618] text-zinc-100" : "text-zinc-500"
            }`}
          >
            Manual
          </button>
        </div>
      </div>

      <div className={`grid gap-2.5 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
        <div className={`block text-[11px] text-zinc-400 ${compact ? "" : "sm:col-span-2"}`}>
          <span>Market</span>
          {catalog.length > 0 && (
            <>
              <input
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Filter markets…"
                aria-label="Filter market picker"
                className={`${inputCls} mb-1.5`}
              />
              <select
                value={catalog.some((m) => m.marketId === marketId) ? marketId : ""}
                onChange={(e) => {
                  if (e.target.value) setMarketId(e.target.value);
                }}
                aria-label="Pick market"
                className={`${inputCls} mb-1.5`}
              >
                <option value="">Select live market…</option>
                {filteredCatalog.map((m) => (
                  <option key={m.marketId} value={m.marketId}>
                    {marketLabel(m, { max: 72 })}
                  </option>
                ))}
              </select>
              {pickerQuery && filteredCatalog.length === 0 && (
                <p className="mb-1.5 text-[10px] text-zinc-500">No catalog hits — paste an id below</p>
              )}
            </>
          )}
          <input
            value={marketId}
            onChange={(e) => setMarketId(e.target.value)}
            placeholder="Or paste marketId"
            aria-label="Market ID"
            className={`${inputCls} font-num`}
          />
        </div>

        <div>
          <div className="text-[11px] text-zinc-400">Side</div>
          <div className="mt-1 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              aria-pressed={side === "yes"}
              onClick={() => setSide("yes")}
              className={`min-h-[44px] rounded-md border py-2 text-sm font-semibold transition active:scale-[0.98] ${
                side === "yes"
                  ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                  : "border-[#1f1f23] text-zinc-500 hover:border-[#2a2a2e]"
              }`}
            >
              YES
            </button>
            <button
              type="button"
              aria-pressed={side === "no"}
              onClick={() => setSide("no")}
              className={`min-h-[44px] rounded-md border py-2 text-sm font-semibold transition active:scale-[0.98] ${
                side === "no"
                  ? "border-rose-400/40 bg-rose-500/15 text-rose-300"
                  : "border-[#1f1f23] text-zinc-500 hover:border-[#2a2a2e]"
              }`}
            >
              NO
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-zinc-400">
            Amount (USDC)
            <input
              value={amountUsdc}
              onChange={(e) => setAmountUsdc(e.target.value)}
              className={`${inputCls} font-num`}
            />
          </label>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {AMOUNT_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmountUsdc(p)}
                className={`rounded border px-2 py-1 font-num text-[11px] transition active:scale-[0.98] ${
                  amountUsdc === p
                    ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
                    : "border-[#1f1f23] text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAmountUsdc("")}
              className="rounded border border-[#1f1f23] px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-300 active:scale-[0.98]"
              title="Clear amount"
            >
              Max
            </button>
          </div>
        </div>

        <label className="block text-[11px] text-zinc-400">
          Max slippage (bps)
          <input
            type="number"
            value={maxSlippageBps}
            onChange={(e) => setMaxSlippageBps(Number(e.target.value))}
            className={`${inputCls} font-num`}
          />
        </label>
        {!compact && (
          <label className="block text-[11px] text-zinc-400 sm:col-span-2">
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
        <div className="mt-3 rounded-md border border-cyan-400/20 bg-cyan-400/[0.04] p-3 text-[12px] leading-relaxed text-zinc-300">
          <p>
            Pay{" "}
            <span className="font-num font-semibold text-cyan-300">
              {quote.amountUsdc || amountUsdc} USDC
            </span>{" "}
            → ~{quote.shares} {quote.side?.toUpperCase() || side.toUpperCase()} @{" "}
            <span className="font-num">{quote.avgPrice}</span>
            {" · "}fee{" "}
            <span className="font-num">{quote.feeUsdc}</span>
            {expiresLabel ? (
              <>
                {" · "}expires in{" "}
                <span className="font-num text-amber-300">{expiresLabel}</span>
              </>
            ) : null}
          </p>
        </div>
      )}

      {signature && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
          <span className="font-num break-all">
            sig <span className="text-emerald-400">{shortAddr(signature, 8)}</span>
          </span>
          <button
            type="button"
            onClick={() => void copySig()}
            className="rounded border border-[#1f1f23] px-1.5 py-0.5 text-zinc-400 hover:text-zinc-200"
          >
            Copy
          </button>
          <a
            href={`https://solscan.io/tx/${signature}`}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-400 hover:underline"
          >
            Explorer
          </a>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="mt-2 flex items-start justify-between gap-2 rounded-md border border-emerald-400/30 bg-emerald-500/15 px-3 py-2.5 text-xs text-emerald-100 shadow-lg shadow-emerald-500/5 animate-fade-in"
        >
          <span className="min-w-0 break-words">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="shrink-0 text-[10px] uppercase tracking-wide text-emerald-300/70 hover:text-emerald-200"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="mt-2 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      {!connected ? (
        <button
          type="button"
          onClick={() => setVisible(true)}
          className={`mt-3 w-full ${btnPrimary}`}
        >
          Connect wallet to quote
        </button>
      ) : mode === "guided" ? (
        <div className={`mt-3 flex flex-col gap-1.5`}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runGuided()}
            className={`w-full ${btnPrimary}`}
          >
            {busy && guidedPhase
              ? guidedPhase
              : step >= 3
                ? "Re-run Quote → Sign"
                : "Quote & continue"}
          </button>
          {step >= 3 && (
            <button
              type="button"
              disabled={busy || !signature}
              onClick={() => void runFinishAttribution()}
              className="w-full rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-200 active:scale-[0.98] disabled:opacity-40"
            >
              {busy && guidedPhase ? guidedPhase : "Finish attribution"}
            </button>
          )}
        </div>
      ) : (
        <div className={`mt-3 flex flex-wrap gap-1.5 ${compact ? "flex-col" : ""}`}>
          <button type="button" disabled={busy} onClick={() => void wrap(runQuote)()} className={btnPrimary}>
            1 · Quote
          </button>
          <button type="button" disabled={busy || !quote} onClick={() => void wrap(runBuild)()} className={btnGhost}>
            2 · Build VT
          </button>
          <button type="button" disabled={busy || !build} onClick={() => void wrap(runSignBroadcast)()} className={btnGhost}>
            3 · Sign & send
          </button>
          <button type="button" disabled={busy || !signature} onClick={() => void wrap(runSubmit)()} className={btnGhost}>
            4 · Submit
          </button>
          <button type="button" disabled={busy || !build} onClick={() => void wrap(runVerify)()} className={btnGhost}>
            5 · Verify
          </button>
          <button
            type="button"
            disabled={busy || !signature}
            onClick={() => void wrap(runAttribute)()}
            className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 disabled:opacity-40"
          >
            6 · POST /trades/
          </button>
        </div>
      )}

      <details className="mt-3 rounded-md border border-[#1f1f23] bg-[#0a0a0b] open:pb-0">
        <summary className="cursor-pointer px-2.5 py-2 text-[10px] uppercase tracking-wide text-zinc-600 hover:text-zinc-400">
          Advanced / raw
        </summary>
        <div className={`grid gap-2 border-t border-[#1f1f23] p-2.5 ${compact ? "" : "lg:grid-cols-2"}`}>
          <div>
            <div className="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-700">
              Desk log
            </div>
            <ul className="max-h-36 space-y-1 overflow-y-auto font-num text-[10px] text-zinc-500">
              {log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
              {log.length === 0 && <li>Idle — run Quote to open a session.</li>}
            </ul>
          </div>
          <div>
            <div className="mb-1.5 text-[10px] uppercase tracking-wide text-zinc-700">
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
      </details>
    </Panel>
  );
}
