"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useCatalog, useHydratedDetails, useInvalidateAttribution } from "@/lib/data/hooks";
import { isInLedger, reportTrade } from "@/lib/panta/attribution";
import { ApiError } from "@/lib/panta/client";
import { mergeMarket } from "@/lib/panta/markets";
import { checkBuild, requestBuild, requestQuote, submitOrder, verifyOrder } from "@/lib/panta/orders";
import { describeErr } from "@/lib/errors";
import { marketLabel, shortAddr } from "@/lib/format";
import { assertFeePayer, programLabel, type InstructionCheck } from "@/lib/panta/instructions";
import { BASE58_PUBKEY_RE } from "@/lib/panta/routes";
import {
  MAX_AMOUNT_USDC,
  MAX_SLIPPAGE_BPS,
  validateAmountUsdc,
  validateAttributionRef,
  validateSlippageBps,
} from "@/lib/panta/validate";
import {
  checkSignatureOnce,
  confirmSignature,
  instructionsToVersionedTx,
  resolveLastValidBlockHeight,
  type ConfirmOutcome,
} from "@/lib/solana";
import type { Json, PrimaryBuild, Quote } from "@/lib/types";
import { Panel } from "./Panel";

const STEPS = [
  "Quote",
  "Build",
  "Sign",
  "Confirm",
  "Submit",
  "Verify",
  "Attr",
] as const;
/** Step index = number of completed stages. */
const S = { quoted: 1, built: 2, broadcast: 3, confirmed: 4, submitted: 5, verified: 6, reported: 7 } as const;

const AMOUNT_PRESETS = ["10", "25", "50", "100"] as const;

/** Verify backoff (ms) — last value repeats until the budget is spent. */
const VERIFY_BACKOFF_MS = [1000, 2000, 2000, 3000, 5000, 8000] as const;
const VERIFY_BUDGET_MS = 30_000;
/**
 * Terminal statuses from POST /primaryorderverify/ (docs.panta.market
 * api-reference/orders/verify): built · submitted (pending) · confirmed ·
 * failed · expired.
 */
const VERIFY_SUCCESS = new Set(["confirmed"]);
const VERIFY_FAILURE = new Set(["failed", "expired"]);
/** Account-ledger re-checks after POST /trades/ (ms between attempts). */
const LEDGER_CHECK_DELAYS_MS = [1500, 3000, 5000] as const;

type TxPhase = "idle" | "confirming" | ConfirmOutcome["status"];
type VerifyPhase = "idle" | "polling" | "confirmed" | "failed" | "timeout";
type AttrPhase = "idle" | "reporting" | "reported" | "attributed";

class StopFlow extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const [prevInitialMarketId, setPrevInitialMarketId] = useState(initialMarketId);
  if (initialMarketId !== prevInitialMarketId) {
    setPrevInitialMarketId(initialMarketId);
    if (initialMarketId) setMarketId(initialMarketId);
  }
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amountInput, setAmountInput] = useState("25");
  const [slippageInput, setSlippageInput] = useState("100");
  const [attrRefInput, setAttrRefInput] = useState("");
  const [mode, setMode] = useState<"guided" | "manual">("guided");

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [guidedPhase, setGuidedPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const onAttributionUpdate = useInvalidateAttribution();
  const [pickerQuery, setPickerQuery] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [build, setBuild] = useState<PrimaryBuild | null>(null);
  const [ixCheck, setIxCheck] = useState<InstructionCheck | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [lastValidBlockHeight, setLastValidBlockHeight] = useState<number | null>(null);
  const [txPhase, setTxPhase] = useState<TxPhase>("idle");
  const [txMessage, setTxMessage] = useState<string | null>(null);
  const [verifyPhase, setVerifyPhase] = useState<VerifyPhase>("idle");
  const [verifyStatus, setVerifyStatus] = useState<string | null>(null);
  const [attrPhase, setAttrPhase] = useState<AttrPhase>("idle");
  const [ledgerSeen, setLedgerSeen] = useState(false);
  const [submitRaw, setSubmitRaw] = useState<Json>(null);
  const [verifyRaw, setVerifyRaw] = useState<Json>(null);
  const [tradeRaw, setTradeRaw] = useState<Json>(null);

  /** Attribution ref bound at quote time (build/report must not contradict it). */
  const sessionAttrRef = useRef<string | undefined>(undefined);

  const amountCheck = validateAmountUsdc(amountInput);
  const slippageCheck = validateSlippageBps(slippageInput);
  const attrCheck = validateAttributionRef(attrRefInput);
  const marketIdValid = BASE58_PUBKEY_RE.test(marketId.trim());
  const quoteInputsValid = amountCheck.ok && attrCheck.ok && marketIdValid;
  const allInputsValid = quoteInputsValid && slippageCheck.ok;

  // Picker catalog: shared primary-phase catalog cache (same query as the
  // landing strip); untitled rows get their detail through the shared ≤4
  // limiter instead of a private fan-out.
  const primaryCatalog = useCatalog({ status: "primary" });
  const pickerRows = useMemo(() => primaryCatalog.items.slice(0, 24), [primaryCatalog.items]);
  const pickerIds = useMemo(
    () => new Set(pickerRows.filter((m) => !m.title).slice(0, 8).map((m) => m.marketId)),
    [pickerRows],
  );
  const pickerDetails = useHydratedDetails(pickerRows, pickerIds);
  const catalog = useMemo(
    () => pickerRows.map((m) => mergeMarket(m, pickerDetails.get(m.marketId))),
    [pickerRows, pickerDetails],
  );

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

  const resetAfterQuote = () => {
    setBuild(null);
    setIxCheck(null);
    setSignature(null);
    setLastValidBlockHeight(null);
    setTxPhase("idle");
    setTxMessage(null);
    setVerifyPhase("idle");
    setVerifyStatus(null);
    setAttrPhase("idle");
    setLedgerSeen(false);
    setSubmitRaw(null);
    setVerifyRaw(null);
    setTradeRaw(null);
  };

  const runQuote = async () => {
    requireReady();
    if (!marketIdValid) throw new Error("Pick a market (valid market id required)");
    if (!amountCheck.ok) throw new Error(amountCheck.error);
    if (!attrCheck.ok) throw new Error(`Attribution reference: ${attrCheck.error}`);
    const ref = attrCheck.value;
    // Parsed strictly (zod) by the orders adapter.
    const { quote: data } = await requestQuote(
      { wallet: publicKey!.toBase58(), marketId: marketId.trim(), side, amountUsdc: amountCheck.value },
      ref,
    );
    sessionAttrRef.current = ref;
    setQuote(data);
    resetAfterQuote();
    setStep(S.quoted);
    push(
      `Quoted ${String(data.side || side).toUpperCase()} · ${data.shares} shares @ avg ${data.avgPrice} (fee ${data.feeUsdc} USDC)`,
    );
    return data;
  };

  const runBuild = async (q?: Quote) => {
    requireReady();
    const activeQuote = q || quote;
    if (!activeQuote?.quoteId) throw new Error("Quote first");
    if (!slippageCheck.ok) throw new Error(slippageCheck.error);
    const ref = sessionAttrRef.current;
    const { build: data } = await requestBuild(
      { quoteId: activeQuote.quoteId, wallet: publicKey!.toBase58(), maxSlippageBps: slippageCheck.value },
      ref,
    );
    const check = checkBuild(data, activeQuote, publicKey!);
    setBuild(data);
    setIxCheck(check);
    setSignature(null);
    setTxPhase("idle");
    setTxMessage(null);
    setVerifyPhase("idle");
    setAttrPhase("idle");
    setLedgerSeen(false);
    setSubmitRaw(null);
    setVerifyRaw(null);
    setTradeRaw(null);
    setStep(S.built);
    push(`Built order ${data.orderId} · ${data.instructions?.length || 0} ix`);
    if (!check.ok) {
      push(`Pre-sign check failed · ${check.reason}`);
      throw new StopFlow(check.reason);
    }
    push(`Pre-sign check passed · ${check.programs.map(programLabel).join(", ")}`);
    return data;
  };

  const applyConfirm = (outcome: ConfirmOutcome) => {
    setTxPhase(outcome.status);
    if (outcome.status === "confirmed") {
      setTxMessage(null);
      setStep((s) => Math.max(s, S.confirmed));
      push("Confirmed on-chain (commitment: confirmed)");
      return true;
    }
    setTxMessage(outcome.message);
    push(
      outcome.status === "expired"
        ? "Blockhash expired before confirmation"
        : outcome.status === "failed"
          ? "Transaction failed on-chain"
          : "Confirmation still pending",
    );
    return false;
  };

  const runSignBroadcast = async (b?: PrimaryBuild, q?: Quote) => {
    requireReady();
    const built = b || build;
    if (!built?.instructions?.length || !built.recentBlockhash) {
      throw new Error("Build first");
    }
    // Re-run the pre-sign check right before signing (defense in depth).
    const check = checkBuild(built, q || quote, publicKey!);
    setIxCheck(check);
    if (!check.ok) throw new StopFlow(check.reason);

    const lvbh = await resolveLastValidBlockHeight(connection, built.lastValidBlockHeight);
    const tx = instructionsToVersionedTx(built.instructions, publicKey!, built.recentBlockhash);
    assertFeePayer(tx, publicKey!);
    const signed = await signTransaction!(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    setSignature(sig);
    setLastValidBlockHeight(lvbh);
    setStep(S.broadcast);
    push(`Broadcast ${sig.slice(0, 16)}… · awaiting confirmation`);
    setTxPhase("confirming");
    setTxMessage(null);

    const outcome = await confirmSignature(connection, sig, built.recentBlockhash, lvbh);
    if (!applyConfirm(outcome)) {
      throw new StopFlow(outcome.status === "confirmed" ? "" : outcome.message);
    }
    return sig;
  };

  const runCheckConfirmation = async (): Promise<boolean> => {
    if (!signature) throw new Error("No broadcast signature");
    setTxPhase("confirming");
    const outcome = await checkSignatureOnce(connection, signature, lastValidBlockHeight);
    const ok = applyConfirm(outcome);
    if (!ok) throw new StopFlow(outcome.status === "confirmed" ? "" : outcome.message);
    return ok;
  };

  const runSubmit = async (opts?: { orderId?: string; sig?: string; confirmed?: boolean }) => {
    requireReady();
    const orderId = opts?.orderId || build?.orderId;
    const sig = opts?.sig || signature;
    if (!orderId || !sig) throw new Error("Need orderId + signature");
    if (!opts?.confirmed && txPhase !== "confirmed") {
      throw new Error("Wait for on-chain confirmation before submitting to Panta");
    }
    const { result, raw } = await submitOrder({ orderId, signature: sig, wallet: publicKey!.toBase58() });
    setSubmitRaw(raw);
    setStep((s) => Math.max(s, S.submitted));
    push(`Submitted signature to Panta · status ${result.status || "unknown"}`);
  };

  /**
   * Poll POST /primaryorderverify/ with backoff (1s, 2s, 2s, 3s, 5s, 8s…)
   * for up to ~30s. Stops on confirmed / failed / expired.
   */
  const runVerify = async (opts?: { orderId?: string; sig?: string | null }) => {
    requireReady();
    const orderId = opts?.orderId || build?.orderId;
    const sig = opts?.sig !== undefined ? opts.sig : signature;
    if (!orderId) throw new Error("Build first");
    setVerifyPhase("polling");
    setVerifyStatus(null);
    push("Verification requested");
    const started = Date.now();
    let attempt = 0;
    let last: string | null = null;
    for (;;) {
      try {
        const { result, raw } = await verifyOrder({ orderId, signature: sig, wallet: publicKey!.toBase58() });
        setVerifyRaw(raw);
        last = result.status;
        setVerifyStatus(last);
        if (last && VERIFY_SUCCESS.has(last)) {
          setVerifyPhase("confirmed");
          setStep((s) => Math.max(s, S.verified));
          push("Verified · Panta order status confirmed");
          return "confirmed" as const;
        }
        if (last && VERIFY_FAILURE.has(last)) {
          setVerifyPhase("failed");
          push(`Verification failed · Panta order status ${last}`);
          throw new StopFlow(`Panta verification failed (order status: ${last}).`);
        }
      } catch (e) {
        if (e instanceof StopFlow) throw e;
        // Transient (rate limit / upstream / network) → keep polling; other API errors are terminal.
        const transient = !(e instanceof ApiError) || e.status === 429 || e.status >= 500;
        if (!transient) {
          setVerifyPhase("failed");
          push(`Verification failed · ${describeErr(e)}`);
          throw e;
        }
      }
      const delay = VERIFY_BACKOFF_MS[Math.min(attempt, VERIFY_BACKOFF_MS.length - 1)];
      if (Date.now() - started + delay > VERIFY_BUDGET_MS) break;
      attempt += 1;
      await sleep(delay);
    }
    setVerifyPhase("timeout");
    push(`Still pending after 30s · last Panta status ${last ?? "unknown"}`);
    return "timeout" as const;
  };

  /** Poll GET /account/trades/ a few times for the signature. */
  const checkLedger = async (sig: string, alreadyAttributed: boolean) => {
    for (const delay of LEDGER_CHECK_DELAYS_MS) {
      await sleep(delay);
      try {
        if (await isInLedger(sig, "buy")) {
          setLedgerSeen(true);
          setAttrPhase("attributed");
          push("Attributed · visible in GET /account/trades/");
          if (!alreadyAttributed) setToast(`Attributed · ${shortAddr(sig, 6)}`);
          onAttributionUpdate();
          return;
        }
      } catch {
        /* keep trying */
      }
    }
    push(
      alreadyAttributed
        ? "Not listed in /account/trades/ yet — refresh Activity shortly"
        : "Reported, not yet in /account/trades/ — refresh Activity shortly",
    );
  };

  const runAttribute = async (opts?: { built?: PrimaryBuild; sig?: string }) => {
    requireReady();
    const built = opts?.built || build;
    const sig = opts?.sig || signature;
    if (!sig || !built) throw new Error("Need broadcast signature");
    const ref = sessionAttrRef.current;
    setAttrPhase("reporting");
    const { report, state, raw } = await reportTrade(
      {
        signature: sig,
        wallet: publicKey!.toBase58(),
        marketId: built.marketId,
        quoteId: built.quoteId,
        clientOrderId: built.orderId,
      },
      ref,
    );
    setTradeRaw(raw);
    setStep(S.reported);
    const status = report.status;
    // docs.panta.market trades/report: status `processed` "when attribution is
    // stored" — the only POST response we treat as definitive.
    const definitive = state === "attributed";
    if (definitive) {
      setAttrPhase("attributed");
      push("Attributed · POST /trades/ status processed");
      setToast(`Attributed · ${shortAddr(sig, 6)}`);
    } else {
      setAttrPhase("reported");
      push(`Trade reported for attribution · status ${status || "unknown"}`);
      setToast(`Trade reported for attribution · ${shortAddr(sig, 6)}`);
    }
    onAttributionUpdate();
    void checkLedger(sig, definitive);
  };

  const fail = (e: unknown) => {
    setError(e instanceof StopFlow ? e.message || null : describeErr(e));
  };

  const runGuided = async () => {
    setBusy(true);
    setError(null);
    try {
      setGuidedPhase("Quoting…");
      const q = await runQuote();
      setGuidedPhase("Building…");
      const b = await runBuild(q);
      setGuidedPhase("Sign in wallet…");
      const sig = await runSignBroadcast(b, q);
      setGuidedPhase("Submitting…");
      await runSubmit({ orderId: b.orderId, sig, confirmed: true });
      setGuidedPhase("Verifying…");
      await runVerify({ orderId: b.orderId, sig });
      setGuidedPhase("Reporting…");
      await runAttribute({ built: b, sig });
      push("Guided path complete");
    } catch (e) {
      fail(e);
    } finally {
      setGuidedPhase(null);
      setBusy(false);
    }
  };

  /** Resume after a broadcast: (re)check confirmation, then Submit → Verify → Report. */
  const runFinishAttribution = async () => {
    setBusy(true);
    setError(null);
    try {
      if (txPhase !== "confirmed") {
        setGuidedPhase("Checking confirmation…");
        await runCheckConfirmation();
      }
      setGuidedPhase("Submitting…");
      await runSubmit({ confirmed: true });
      setGuidedPhase("Verifying…");
      await runVerify();
      setGuidedPhase("Reporting…");
      await runAttribute();
    } catch (e) {
      fail(e);
    } finally {
      setGuidedPhase(null);
      setBusy(false);
    }
  };

  const wrap = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      fail(e);
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

  const expiresLabel = quote?.expiresAt ? countdownLabel(quote.expiresAt, now) : null;

  const inputCls =
    "mt-1 w-full rounded-md border border-line bg-inset px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400/40";
  const inputErrCls = "border-rose-500/50 focus:border-rose-400/60";
  const btnPrimary =
    "min-h-[48px] rounded-md bg-cyan-400 px-3 py-3 text-sm font-semibold text-bg transition hover:bg-cyan-300 active:scale-[0.98] disabled:opacity-40";
  const btnGhost =
    "min-h-[44px] rounded-md border border-line bg-inset px-3 py-2.5 text-sm text-zinc-300 transition hover:border-line-strong hover:text-zinc-100 active:scale-[0.98] disabled:opacity-40";

  const copySig = async () => {
    if (!signature) return;
    try {
      await navigator.clipboard.writeText(signature);
      setToast("Signature copied");
    } catch {
      /* ignore */
    }
  };

  const selectedMarket = useMemo(
    () => catalog.find((m) => m.marketId === marketId) || null,
    [catalog, marketId],
  );

  const formatEndShort = (ts?: number | null) => {
    if (!ts) return "—";
    return new Date(ts * 1000).toLocaleString("en-IN", {
      timeZone: "Asia/Calcutta",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  /** Chip tone per lifecycle stage (honest: pending/failed are not "done"). */
  const chipTone = (i: number): "done" | "active" | "warn" | "bad" | "idle" => {
    const label = STEPS[i];
    if (label === "Confirm") {
      if (txPhase === "failed" || txPhase === "expired") return "bad";
      if (txPhase === "pending") return "warn";
    }
    if (label === "Verify") {
      if (verifyPhase === "failed") return "bad";
      if (verifyPhase === "timeout") return "warn";
    }
    if (label === "Attr" && attrPhase === "reported") return "warn";
    if (step > i) return "done";
    if (step === i) return "active";
    return "idle";
  };
  const chipCls: Record<ReturnType<typeof chipTone>, string> = {
    done: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
    active: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
    warn: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    bad: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    idle: "border-line text-zinc-600",
  };

  const statusLabel = guidedPhase
    ? guidedPhase
    : step === 0
      ? "Ready to quote"
      : step >= STEPS.length
        ? attrPhase === "attributed"
          ? "Attributed"
          : "Reported for attribution"
        : STEPS[Math.min(step, STEPS.length - 1)];

  const blockingHint = !marketIdValid
    ? "Pick a market to quote."
    : !amountCheck.ok
      ? `Amount: ${amountCheck.error}`
      : !slippageCheck.ok
        ? `Slippage: ${slippageCheck.error}`
        : !attrCheck.ok
          ? `Attribution reference (Advanced): ${attrCheck.error}`
          : null;

  const needsRestart = txPhase === "expired" || txPhase === "failed";
  const canResume = Boolean(signature) && step >= S.broadcast && step < S.reported && !needsRestart;

  return (
    <Panel title={compact ? "Execute ticket" : "Primary buy"}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label="Execute progress"
        >
          <span className="text-[10px] text-zinc-500">{statusLabel}</span>
          <span className="font-num text-[10px] text-zinc-600">
            {Math.min(step + 1, STEPS.length)}/{STEPS.length}
          </span>
          {!compact && (
            <div className="ml-1 hidden flex-wrap gap-1 sm:flex" role="presentation">
              {STEPS.map((label, i) => (
                <span
                  key={label}
                  aria-current={step === i ? "step" : undefined}
                  className={`step-chip rounded border px-1.5 py-0.5 text-[9px] font-medium tracking-wide transition-all duration-300 ${chipCls[chipTone(i)]}`}
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="inline-flex rounded-md border border-line bg-inset p-0.5">
          <button
            type="button"
            aria-pressed={mode === "guided"}
            onClick={() => setMode("guided")}
            className={`rounded px-2 py-0.5 text-[10px] ${
              mode === "guided" ? "bg-elevated text-zinc-100" : "text-zinc-500"
            }`}
          >
            Guided
          </button>
          <button
            type="button"
            aria-pressed={mode === "manual"}
            onClick={() => setMode("manual")}
            className={`rounded px-2 py-0.5 text-[10px] ${
              mode === "manual" ? "bg-elevated text-zinc-100" : "text-zinc-500"
            }`}
          >
            Manual
          </button>
        </div>
      </div>

      <div className={`grid gap-2.5 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
        <div className={`block text-[11px] text-zinc-400 ${compact ? "" : "sm:col-span-2"}`}>
          <span>Market</span>
          {compact ? (
            <div className="mt-1 rounded-md border border-line bg-inset px-3 py-2.5">
              <div className="text-[12px] font-medium leading-snug text-zinc-200">
                {selectedMarket
                  ? marketLabel(selectedMarket, { max: 96 })
                  : marketId
                    ? shortAddr(marketId, 8)
                    : "This market"}
              </div>
              {selectedMarket && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 font-medium uppercase tracking-wide text-cyan-300">
                    {selectedMarket.phase || "—"}
                  </span>
                  <span className="text-zinc-500">Ends</span>
                  <span className="font-num text-zinc-300">
                    {formatEndShort(selectedMarket.endTime)} IST
                  </span>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="relative mt-1">
                <input
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Search markets…"
                  aria-label="Search markets"
                  className={`${inputCls} mb-1.5`}
                />
                <select
                  value={catalog.some((m) => m.marketId === marketId) ? marketId : ""}
                  onChange={(e) => {
                    if (e.target.value) {
                      setMarketId(e.target.value);
                      setPickerQuery("");
                    }
                  }}
                  aria-label="Pick market"
                  className={inputCls}
                >
                  <option value="">
                    {filteredCatalog.length
                      ? "Select a live market…"
                      : pickerQuery
                        ? "No matches — open Advanced to paste ID"
                        : "Loading catalog…"}
                  </option>
                  {filteredCatalog.map((m) => (
                    <option key={m.marketId} value={m.marketId}>
                      {marketLabel(m, { max: 72 })}
                    </option>
                  ))}
                </select>
              </div>
              {selectedMarket && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 font-medium uppercase tracking-wide text-cyan-300">
                    {selectedMarket.phase || "—"}
                  </span>
                  <span className="text-zinc-500">Ends</span>
                  <span className="font-num text-zinc-300">
                    {formatEndShort(selectedMarket.endTime)} IST
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <div className="text-[11px] text-zinc-400">Side</div>
          <div className="mt-1 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              aria-pressed={side === "yes"}
              onClick={() => setSide("yes")}
              className={`min-h-[48px] rounded-md border py-2.5 text-sm font-semibold transition active:scale-[0.98] ${
                side === "yes"
                  ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                  : "border-line text-zinc-500 hover:border-line-strong"
              }`}
            >
              YES
            </button>
            <button
              type="button"
              aria-pressed={side === "no"}
              onClick={() => setSide("no")}
              className={`min-h-[48px] rounded-md border py-2.5 text-sm font-semibold transition active:scale-[0.98] ${
                side === "no"
                  ? "border-rose-400/40 bg-rose-500/15 text-rose-300"
                  : "border-line text-zinc-500 hover:border-line-strong"
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
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              aria-invalid={!amountCheck.ok}
              aria-describedby="amount-help"
              className={`${inputCls} font-num ${amountCheck.ok ? "" : inputErrCls}`}
            />
          </label>
          <p
            id="amount-help"
            className={`mt-1 text-[10px] ${amountCheck.ok ? "text-zinc-600" : "text-rose-300"}`}
          >
            {amountCheck.ok
              ? `Up to 2 decimals · max ${MAX_AMOUNT_USDC.toLocaleString()} USDC`
              : amountCheck.error}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {AMOUNT_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmountInput(p)}
                className={`min-h-[40px] min-w-[44px] rounded border px-3 py-2 font-num text-[12px] transition active:scale-[0.98] ${
                  amountInput === p
                    ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
                    : "border-line text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAmountInput("")}
              className="min-h-[40px] rounded border border-line px-3 py-2 text-[12px] text-zinc-400 hover:text-zinc-300 active:scale-[0.98]"
              title="Clear amount"
            >
              Clear
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-zinc-400">
            Max slippage (bps)
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={slippageInput}
              onChange={(e) => setSlippageInput(e.target.value)}
              aria-invalid={!slippageCheck.ok}
              aria-describedby="slippage-help"
              className={`${inputCls} font-num ${slippageCheck.ok ? "" : inputErrCls}`}
            />
          </label>
          <p
            id="slippage-help"
            className={`mt-1 text-[10px] ${slippageCheck.ok ? "text-zinc-600" : "text-rose-300"}`}
          >
            {slippageCheck.ok
              ? `${(slippageCheck.value / 100).toFixed(2)}% · whole bps, 0–${MAX_SLIPPAGE_BPS}`
              : slippageCheck.error}
          </p>
        </div>

        <details
          className={`rounded-md border border-line bg-inset ${compact ? "" : "sm:col-span-2"}`}
        >
          <summary className="min-h-[36px] cursor-pointer px-2.5 py-2 text-[10px] uppercase tracking-wide text-zinc-500 hover:text-zinc-300">
            Advanced
          </summary>
          <div className="border-t border-line p-2.5">
            <label className="block text-[11px] text-zinc-400">
              Attribution reference (optional)
              <input
                value={attrRefInput}
                onChange={(e) => setAttrRefInput(e.target.value)}
                maxLength={128}
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. campaign_q3"
                aria-invalid={!attrCheck.ok}
                aria-describedby="attr-ref-help"
                className={`${inputCls} font-num ${attrCheck.ok ? "" : inputErrCls}`}
              />
            </label>
            <p id="attr-ref-help" className="mt-1 text-[10px] leading-relaxed text-zinc-600">
              User-supplied attribution metadata, not an authenticated identity.
              Sent as Panta <span className="font-num">userId</span> on quote, build, and report.
            </p>
            {!attrCheck.ok && (
              <p className="mt-1 text-[10px] text-rose-300">{attrCheck.error}</p>
            )}
          </div>
        </details>

      </div>

      {quote && (
        <div className="mt-3 rounded-md border border-cyan-400/20 bg-cyan-400/[0.04] p-3 text-[12px] leading-relaxed text-zinc-300">
          <p className="text-[13px]">
            Pay{" "}
            <span className="font-num font-semibold text-cyan-300">
              {quote.amountUsdc} USDC
            </span>{" "}
            → ~{quote.shares} {quote.side?.toUpperCase() || side.toUpperCase()} @{" "}
            <span className="font-num">{quote.avgPrice}</span>
          </p>
          <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-cyan-400/15 pt-2.5 text-[11px]">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Fee</dt>
              <dd className="mt-0.5 font-num font-medium text-zinc-200">{quote.feeUsdc} USDC</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Slippage</dt>
              <dd className="mt-0.5 font-num font-medium text-zinc-200">
                {slippageCheck.ok ? `${slippageCheck.value} bps` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Expires</dt>
              <dd className={`mt-0.5 font-num font-medium ${expiresLabel === "0:00" ? "text-rose-300" : "text-amber-300"}`}>
                {expiresLabel || "—"}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {build && (
        <div
          className={`mt-2 rounded-md border p-3 text-[12px] ${
            ixCheck?.ok === false
              ? "border-rose-500/30 bg-rose-500/[0.06]"
              : "border-line bg-inset"
          }`}
          aria-label="Pre-sign summary"
        >
          <div className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">
            Pre-sign summary
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] sm:grid-cols-3">
            <div>
              <dt className="text-[10px] text-zinc-500">Wallet</dt>
              <dd className="font-num text-zinc-200">{shortAddr(publicKey?.toBase58(), 4)}</dd>
            </div>
            <div className="col-span-1 sm:col-span-2">
              <dt className="text-[10px] text-zinc-500">Market</dt>
              <dd className="truncate text-zinc-200" title={build.marketId}>
                {selectedMarket && selectedMarket.marketId === build.marketId
                  ? marketLabel(selectedMarket, { max: 64 })
                  : shortAddr(build.marketId, 6)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] text-zinc-500">Side</dt>
              <dd
                className={`font-semibold ${
                  build.side?.toLowerCase() === "no" ? "text-rose-300" : "text-emerald-300"
                }`}
              >
                {build.side?.toUpperCase() || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] text-zinc-500">Amount</dt>
              <dd className="font-num text-zinc-200">{build.amountUsdc} USDC</dd>
            </div>
            <div>
              <dt className="text-[10px] text-zinc-500">Fee</dt>
              <dd className="font-num text-zinc-200">{build.feeUsdc} USDC</dd>
            </div>
            <div>
              <dt className="text-[10px] text-zinc-500">Expected shares</dt>
              <dd className="font-num text-zinc-200">{build.expectedShares}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[10px] text-zinc-500">Instructions</dt>
              <dd className="text-zinc-300">
                {ixCheck?.ok
                  ? `${ixCheck.count} ix · ${ixCheck.programs.map(programLabel).join(", ")}`
                  : `${build.instructions?.length ?? 0} ix`}
              </dd>
            </div>
          </dl>
          <p
            className={`mt-2 text-[11px] ${ixCheck?.ok === false ? "text-rose-200" : "text-emerald-300/80"}`}
            role={ixCheck?.ok === false ? "alert" : undefined}
          >
            {ixCheck?.ok === false
              ? ixCheck.reason
              : ixCheck?.ok
                ? "Checked: fee payer and only signer is your wallet; every program is on the allowlist."
                : "Pending instruction check."}
          </p>
        </div>
      )}

      {signature && (
        <ul
          className="mt-2 space-y-1 rounded-md border border-line bg-inset px-3 py-2 text-[11px]"
          aria-label="Execution status"
          aria-live="polite"
        >
          <li className="flex items-start justify-between gap-2">
            <span className="text-zinc-500">On-chain</span>
            <span
              className={`text-right ${
                txPhase === "confirmed"
                  ? "text-emerald-300"
                  : txPhase === "failed" || txPhase === "expired"
                    ? "text-rose-300"
                    : "text-amber-300"
              }`}
            >
              {txPhase === "confirming"
                ? "Confirming…"
                : txPhase === "confirmed"
                  ? "Confirmed"
                  : txPhase === "expired"
                    ? "Expired — did not land"
                    : txPhase === "failed"
                      ? "Failed on-chain"
                      : txPhase === "pending"
                        ? "Not confirmed yet"
                        : "Broadcast"}
            </span>
          </li>
          {txMessage && txPhase !== "confirmed" && (
            <li className="text-[10px] leading-relaxed text-zinc-400">{txMessage}</li>
          )}
          <li className="flex items-start justify-between gap-2">
            <span className="text-zinc-500">Panta verify</span>
            <span
              className={`text-right ${
                verifyPhase === "confirmed"
                  ? "text-emerald-300"
                  : verifyPhase === "failed"
                    ? "text-rose-300"
                    : verifyPhase === "idle"
                      ? "text-zinc-600"
                      : "text-amber-300"
              }`}
            >
              {verifyPhase === "polling"
                ? `Polling${verifyStatus ? ` · ${verifyStatus}` : "…"}`
                : verifyPhase === "confirmed"
                  ? "Verified"
                  : verifyPhase === "timeout"
                    ? `Still pending after 30s${verifyStatus ? ` · ${verifyStatus}` : ""}`
                    : verifyPhase === "failed"
                      ? `Verification failed${verifyStatus ? ` · ${verifyStatus}` : ""}`
                      : "Not requested"}
            </span>
          </li>
          <li className="flex items-start justify-between gap-2">
            <span className="text-zinc-500">Attribution</span>
            <span
              className={`text-right ${
                attrPhase === "attributed"
                  ? "text-emerald-300"
                  : attrPhase === "idle"
                    ? "text-zinc-600"
                    : "text-amber-300"
              }`}
            >
              {attrPhase === "reporting"
                ? "Reporting…"
                : attrPhase === "reported"
                  ? "Trade reported for attribution · awaiting ledger"
                  : attrPhase === "attributed"
                    ? ledgerSeen
                      ? "Attributed · in account ledger"
                      : "Attributed"
                    : "Not reported"}
            </span>
          </li>
        </ul>
      )}

      {signature && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
          <span className="font-num break-all">
            sig <span className="text-emerald-400">{shortAddr(signature, 8)}</span>
          </span>
          <button
            type="button"
            onClick={() => void copySig()}
            className="rounded border border-line px-1.5 py-0.5 text-zinc-400 hover:text-zinc-200"
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
            disabled={busy || !allInputsValid}
            onClick={() => void runGuided()}
            className={`w-full ${btnPrimary}`}
          >
            {busy && guidedPhase
              ? guidedPhase
              : step >= S.reported
                ? "Buy again · Quote → Attribute"
                : needsRestart
                  ? "Start over · new quote"
                  : "Buy · Quote → Attribute"}
          </button>
          {canResume && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void runFinishAttribution()}
              className="min-h-[48px] w-full rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-200 active:scale-[0.98] disabled:opacity-40"
            >
              {busy && guidedPhase
                ? guidedPhase
                : txPhase === "confirmed"
                  ? "Retry Submit → Verify → Report"
                  : "Check confirmation → Submit → Verify → Report"}
            </button>
          )}
        </div>
      ) : (
        <div className={`mt-3 flex flex-wrap gap-1.5 ${compact ? "flex-col" : ""}`}>
          <button type="button" disabled={busy || !quoteInputsValid} onClick={() => void wrap(runQuote)()} className={btnPrimary}>
            1 · Quote
          </button>
          <button type="button" disabled={busy || !quote || !slippageCheck.ok} onClick={() => void wrap(() => runBuild())()} className={btnGhost}>
            2 · Build VT
          </button>
          <button type="button" disabled={busy || !build || ixCheck?.ok !== true} onClick={() => void wrap(() => runSignBroadcast())()} className={btnGhost}>
            3 · Sign, send & confirm
          </button>
          {signature && txPhase === "pending" && (
            <button type="button" disabled={busy} onClick={() => void wrap(runCheckConfirmation)()} className={btnGhost}>
              Check confirmation
            </button>
          )}
          <button type="button" disabled={busy || !signature || txPhase !== "confirmed"} onClick={() => void wrap(() => runSubmit())()} className={btnGhost}>
            4 · Submit
          </button>
          <button type="button" disabled={busy || !build || !signature} onClick={() => void wrap(() => runVerify())()} className={btnGhost}>
            5 · Verify (poll ≤30s)
          </button>
          <button
            type="button"
            disabled={busy || !signature || txPhase !== "confirmed"}
            onClick={() => void wrap(() => runAttribute())()}
            className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 disabled:opacity-40"
          >
            6 · POST /trades/
          </button>
        </div>
      )}

      {connected && blockingHint && !busy && (
        <p className="mt-1.5 text-[11px] text-zinc-500" role="status">
          {blockingHint}
        </p>
      )}

      <details className={`mt-3 rounded-md border border-line bg-inset open:pb-0 ${compact ? "hidden sm:block" : ""}`}>
        <summary className="min-h-[40px] cursor-pointer px-2.5 py-2 text-[10px] uppercase tracking-wide text-zinc-600 hover:text-zinc-400">
          Raw / debug
        </summary>
        <div className={`grid gap-2 border-t border-line p-2.5 ${compact ? "" : "lg:grid-cols-2"}`}>
          {!compact && (
            <div className="space-y-2 lg:col-span-2">
              <label className="block text-[11px] text-zinc-400">
                Paste market ID
                <input
                  value={marketId}
                  onChange={(e) => setMarketId(e.target.value)}
                  placeholder="Market public key"
                  aria-label="Paste market ID"
                  className={`${inputCls} font-num`}
                />
              </label>
            </div>
          )}
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
