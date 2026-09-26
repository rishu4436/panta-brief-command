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
import type { Json, Market, PrimaryBuild, Quote } from "@/lib/types";
import {
  TRADE_STATES,
  classifyFailure,
  deriveTradeState,
  formatClock,
  quoteDeadline,
  secondsLeft,
  type AttrPhase,
  type FlowStage,
  type StepId,
  type TradeStateId,
  type VerifyPhase,
} from "@/lib/trade-state";
import { Panel } from "./Panel";
import { TransactionStepper } from "./TransactionStepper";
import { MarketSummary, QuoteSummary, SideToggle, stepsForState } from "./trade/TicketParts";
import { TradeStateNotice } from "./trade/TradeStateNotice";
import { IconWallet } from "./ui/Icons";

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
type Stage = FlowStage;

class StopFlow extends Error {}
/** The pre-sign check blocked the transaction (never shown to the wallet). */
class PresignStop extends StopFlow {}
/** The quote ran out before the wallet was opened. */
class ExpiredStop extends StopFlow {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function PrimaryBuyPanel({
  initialMarketId = "",
  compact = false,
  market: contextMarket = null,
}: {
  initialMarketId?: string;
  compact?: boolean;
  /** The market being viewed (market page), used for phase-aware states. */
  market?: Market | null;
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
  const [failure, setFailure] = useState<TradeStateId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const onAttributionUpdate = useInvalidateAttribution();
  const [pickerQuery, setPickerQuery] = useState("");

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteReceivedAt, setQuoteReceivedAt] = useState(0);
  const [verifyStartedAt, setVerifyStartedAt] = useState<number | null>(null);
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [stage, setStageState] = useState<Stage | null>(null);
  const stageRef = useRef<Stage | null>(null);
  const setStage = (st: Stage | null) => {
    stageRef.current = st;
    setStageState(st);
  };

  /** Attribution ref bound at quote time (build/report must not contradict it). */
  const sessionAttrRef = useRef<string | undefined>(undefined);

  const amountCheck = validateAmountUsdc(amountInput);
  const slippageCheck = validateSlippageBps(slippageInput);
  const attrCheck = validateAttributionRef(attrRefInput);
  const marketIdValid = BASE58_PUBKEY_RE.test(marketId.trim());
  const quoteInputsValid = amountCheck.ok && attrCheck.ok && marketIdValid;

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

  // One clock for the quote countdown and the verify elapsed time.
  const ticking = Boolean(quote) || verifyStartedAt != null;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

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
    setVerifyStartedAt(null);
  };

  /** Hard stop before anything that would open the wallet on an expired quote. */
  const assertQuoteLive = (q: Quote | null) => {
    if (!q) return;
    const { deadlineMs } = quoteDeadline(q.expiresAt, quoteReceivedAt || Date.now());
    if (Date.now() >= deadlineMs) {
      setNow(Date.now());
      throw new ExpiredStop("Quote expired before approval.");
    }
  };

  const runQuote = async () => {
    setStage("quote");
    setReviewOpen(false);
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
    setQuoteReceivedAt(Date.now());
    setNow(Date.now());
    resetAfterQuote();
    setStep(S.quoted);
    push(
      `Quoted ${String(data.side || side).toUpperCase()} · ${data.shares} shares @ avg ${data.avgPrice} (fee ${data.feeUsdc} USDC)`,
    );
    return data;
  };

  const runBuild = async (q?: Quote) => {
    setStage("build");
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
      throw new PresignStop(check.reason);
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
    setStage("sign");
    requireReady();
    const built = b || build;
    if (!built?.instructions?.length || !built.recentBlockhash) {
      throw new Error("Build first");
    }
    assertQuoteLive(q || quote);
    // Re-run the pre-sign check right before signing (defense in depth).
    const check = checkBuild(built, q || quote, publicKey!);
    setIxCheck(check);
    if (!check.ok) throw new PresignStop(check.reason);

    const lvbh = await resolveLastValidBlockHeight(connection, built.lastValidBlockHeight);
    const tx = instructionsToVersionedTx(built.instructions, publicKey!, built.recentBlockhash);
    try {
      assertFeePayer(tx, publicKey!);
    } catch (e) {
      throw new PresignStop(describeErr(e));
    }
    const signed = await signTransaction!(tx);
    setStage("broadcast");
    push("Signed in wallet · sending");
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    setSignature(sig);
    setStage("confirm");
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
    setStage("confirm");
    setTxPhase("confirming");
    const outcome = await checkSignatureOnce(connection, signature, lastValidBlockHeight);
    const ok = applyConfirm(outcome);
    if (!ok) throw new StopFlow(outcome.status === "confirmed" ? "" : outcome.message);
    return ok;
  };

  const runSubmit = async (opts?: { orderId?: string; sig?: string; confirmed?: boolean }) => {
    setStage("submit");
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
    setStage("verify");
    requireReady();
    const orderId = opts?.orderId || build?.orderId;
    const sig = opts?.sig !== undefined ? opts.sig : signature;
    if (!orderId) throw new Error("Build first");
    setVerifyPhase("polling");
    setVerifyStatus(null);
    push("Verification requested");
    const started = Date.now();
    setVerifyStartedAt(started);
    setNow(started);
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
    setStage("attribute");
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
    } else {
      setAttrPhase("reported");
      push(`Trade reported for attribution · status ${status || "unknown"}`);
    }
    onAttributionUpdate();
    void checkLedger(sig, definitive);
  };

  const fail = (e: unknown) => {
    const kind: TradeStateId =
      e instanceof ExpiredStop
        ? "quote_expired"
        : classifyFailure(stageRef.current, e, { presign: e instanceof PresignStop });
    setFailure(kind);
    // A declined signature needs no raw wallet text; everything else keeps the specifics.
    setError(kind === "signature_rejected" || kind === "quote_expired" ? null : e instanceof StopFlow ? e.message || null : describeErr(e));
    if (kind === "signature_rejected") push("Signature rejected in wallet · nothing sent");
  };

  const begin = () => {
    setBusy(true);
    setError(null);
    setFailure(null);
  };

  /** Guided step 1: quote (fees always shown before anything is built). */
  const runGetQuote = async () => {
    begin();
    try {
      setGuidedPhase("Getting quote…");
      await runQuote();
    } catch (e) {
      fail(e);
    } finally {
      setGuidedPhase(null);
      setBusy(false);
    }
  };

  /** Guided step 2: build + pre-sign check, then show the review screen. The wallet is NOT opened here. */
  const runReview = async () => {
    begin();
    try {
      setGuidedPhase("Building & checking…");
      await runBuild(quote ?? undefined);
      setReviewOpen(true);
    } catch (e) {
      fail(e);
    } finally {
      setGuidedPhase(null);
      setBusy(false);
    }
  };

  /** Guided step 3 (after review): wallet approval → confirm → submit → verify → report. */
  const runApprove = async () => {
    if (!build || !quote) return;
    const b = build;
    const q = quote;
    begin();
    try {
      setStage("sign");
      assertQuoteLive(q);
      setReviewOpen(false);
      setGuidedPhase("Approve in your wallet…");
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

  /** After a slow or failed verify: poll again, then report if not yet reported. */
  const runRecheckVerify = async () => {
    begin();
    try {
      setGuidedPhase("Verifying…");
      await runVerify();
      if (attrPhase === "idle") {
        setGuidedPhase("Reporting…");
        await runAttribute();
      } else if (signature) {
        void checkLedger(signature, false);
      }
    } catch (e) {
      fail(e);
    } finally {
      setGuidedPhase(null);
      setBusy(false);
    }
  };

  /** Resume after a broadcast: (re)check confirmation, then Submit → Verify → Report. */
  const runFinishAttribution = async () => {
    begin();
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
    begin();
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


  const inputCls = "field mt-1";
  const inputErrCls = "!border-rose-500/60";
  const btnGhost = "btn btn-secondary";

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
    () =>
      (contextMarket && contextMarket.marketId === marketId ? contextMarket : null) ||
      catalog.find((m) => m.marketId === marketId) ||
      null,
    [catalog, marketId, contextMarket],
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

  const phase = (selectedMarket?.phase || "").toLowerCase();
  const resolved = Boolean(selectedMarket?.resolved) || phase === "resolved";
  const cancelled = phase === "cancelled" || phase === "canceled";
  const secondary = phase === "secondary";
  // Only block when the phase is known and not primary; an unknown phase may still quote.
  const closedKind = resolved ? "resolved" : cancelled ? "cancelled" : secondary ? "secondary" : null;

  // ---- Quote clock: Panta's expiresAt, else a documented conservative TTL ----
  const deadline = quote ? quoteDeadline(quote.expiresAt, quoteReceivedAt || now) : null;
  const quoteSecondsLeft = deadline ? secondsLeft(deadline.deadlineMs, now) : null;
  const quoteTotalSeconds = deadline ? Math.max(1, Math.round((deadline.deadlineMs - (quoteReceivedAt || now)) / 1000)) : null;
  const quoteExpired = quoteSecondsLeft === 0;
  const quoteStale = Boolean(
    quote &&
      (quote.marketId !== marketId.trim() ||
        (amountCheck.ok && Number(quote.amountUsdc) !== Number(amountCheck.value)) ||
        (quote.side && quote.side !== side)),
  );

  const blockingHint = !marketIdValid
    ? "Pick a market to quote."
    : !amountCheck.ok
      ? `Amount: ${amountCheck.error}`
      : !slippageCheck.ok
        ? `Slippage: ${slippageCheck.error}`
        : !attrCheck.ok
          ? `Attribution reference (Advanced): ${attrCheck.error}`
          : null;

  const done = step >= S.reported;

  // ---- One derived state drives the notice, the stepper and the header ----
  const tradeState = deriveTradeState({
    connected: Boolean(connected && publicKey),
    closed: closedKind,
    running: busy ? stage : null,
    failure,
    hasQuote: Boolean(quote),
    quoteExpired,
    quoteStale,
    hasBuild: Boolean(build),
    presignOk: ixCheck?.ok === true,
    reviewOpen,
    hasSignature: Boolean(signature),
    txPhase,
    verifyPhase,
    attrPhase,
  });
  const spec = TRADE_STATES[tradeState];

  const verifyText =
    verifyPhase === "polling"
      ? `Panta status ${verifyStatus ?? "requested"}`
      : verifyPhase === "confirmed"
        ? "Panta order status confirmed"
        : verifyPhase === "timeout"
          ? `No final status after 30 s${verifyStatus ? ` (last: ${verifyStatus})` : ""}`
          : verifyPhase === "failed"
            ? `Panta order status ${verifyStatus ?? "error"}`
            : undefined;
  const attrText =
    attrPhase === "reporting"
      ? "Reporting to Panta…"
      : attrPhase === "reported"
        ? "Reported, waiting for the account ledger"
        : attrPhase === "attributed"
          ? ledgerSeen
            ? "Attributed · in account ledger"
            : "Attributed · POST /trades/ processed"
          : undefined;
  const stepDetails: Partial<Record<StepId, React.ReactNode>> = {
    quote: quote ? `${quote.shares} ${String(quote.side || side).toUpperCase()} @ ${quote.avgPrice} · fee ${quote.feeUsdc} USDC` : undefined,
    build: ixCheck?.ok === false ? ixCheck.reason : build && ixCheck?.ok ? "Pre-sign check passed" : undefined,
    sign: tradeState === "awaiting_signature" ? "Approve the transaction in your wallet" : tradeState === "signature_rejected" ? "Declined in wallet · nothing sent" : undefined,
    broadcast: signature ? `Sent · ${shortAddr(signature, 6)}` : undefined,
    confirm:
      txPhase === "confirmed"
        ? "Confirmed on Solana"
        : txPhase === "expired"
          ? "Blockhash expired: the transaction did not land"
          : txPhase === "failed"
            ? "Failed on-chain"
            : txPhase === "pending"
              ? txMessage || "Not confirmed yet"
              : undefined,
    verify: verifyText,
    attribute: attrText,
  };
  const steps = stepsForState(tradeState, stepDetails);
  const showStepper = Boolean(quote) || step > 0;

  const verifyElapsed = verifyStartedAt != null ? Math.max(0, Math.floor((now - verifyStartedAt) / 1000)) : null;
  const noticeMeta =
    (tradeState === "verifying" || tradeState === "verify_slow") && verifyElapsed != null
      ? `${verifyElapsed}s elapsed`
      : (tradeState === "quote_ready" || tradeState === "review") && quoteSecondsLeft != null
        ? `Expires in ${formatClock(quoteSecondsLeft)}`
        : undefined;

  const marketTitle = selectedMarket
    ? marketLabel(selectedMarket, { max: 96 })
    : marketId
      ? shortAddr(marketId, 8)
      : "This market";

  // Guided: the notice's one action is the ticket's primary button.
  const noticeAction = (): { onAction?: () => void; disabled?: boolean; label?: string } => {
    switch (spec.action) {
      case "connect":
        return { onAction: () => setVisible(true) };
      case "get_quote":
      case "refresh_quote":
      case "new_quote":
        return { onAction: () => void runGetQuote(), disabled: busy || !quoteInputsValid };
      case "review":
        return { onAction: () => void runReview(), disabled: busy || !slippageCheck.ok || quoteExpired };
      case "approve":
        // The review panel below carries Back / Approve.
        return {};
      case "retry_sign":
        return build && !quoteExpired ? { onAction: () => void runApprove(), disabled: busy } : { onAction: () => void runGetQuote(), disabled: busy || !quoteInputsValid, label: "Get a new quote" };
      case "check_confirmation":
      case "submit":
        return { onAction: () => void runFinishAttribution(), disabled: busy };
      case "recheck_verify":
        return { onAction: () => void runRecheckVerify(), disabled: busy };
      default:
        return {};
    }
  };
  const na = mode === "guided" || spec.action === "connect" ? noticeAction() : {};

  const marketBlock = (
    <MarketSummary
      title={marketTitle}
      phase={selectedMarket?.phase}
      endsLabel={selectedMarket?.endTime ? `${formatEndShort(selectedMarket.endTime)} IST` : null}
    />
  );

  return (
    <Panel
      id="trade"
      title="Execute Trade"
      subtitle={compact ? undefined : "Primary buy"}
      action={
        <span className="mr-4 flex items-center gap-2 text-[11px] text-ink-3" data-trade-header>
          {guidedPhase ?? spec.title}
        </span>
      }
    >
      {/* Buy / Sell: primary markets are buy-only */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="segmented" role="group" aria-label="Order type">
          <button type="button" aria-pressed="true">
            Buy
          </button>
          <button type="button" disabled aria-disabled="true" title="Panta primary markets are buy-only" className="cursor-not-allowed opacity-50">
            Sell
          </button>
        </div>
        {!closedKind && (
          <div className="segmented" role="group" aria-label="Execution mode">
            <button type="button" aria-pressed={mode === "guided"} onClick={() => setMode("guided")}>
              Guided
            </button>
            <button type="button" aria-pressed={mode === "manual"} onClick={() => setMode("manual")}>
              Step-by-step
            </button>
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        Primary markets are buy-only. You exit by claiming in your Book after the market resolves.
      </p>

      {closedKind ? (
        <div className="mt-4 space-y-3">
          {marketBlock}
          <TradeStateNotice state={tradeState} />
        </div>
      ) : (
        <>
          <div className={`mt-4 grid gap-3 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
            <div className={`block text-[12px] text-ink-3 ${compact ? "" : "sm:col-span-2"}`}>
              <span>Market</span>
              {compact ? (
                <div className="mt-1">{marketBlock}</div>
              ) : (
                <>
                  <div className="relative mt-1">
                    <input
                      value={pickerQuery}
                      onChange={(e) => setPickerQuery(e.target.value)}
                      placeholder="Search open markets…"
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
                          ? "Select an open market…"
                          : pickerQuery
                            ? "No matches — open Advanced to paste an ID"
                            : "Loading catalog…"}
                      </option>
                      {filteredCatalog.map((m) => (
                        <option key={m.marketId} value={m.marketId}>
                          {marketLabel(m, { max: 72 })}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedMarket && <div className="mt-2">{marketBlock}</div>}
                </>
              )}
            </div>

            <SideToggle side={side} onChange={setSide} />

            <div>
              <label className="block text-[12px] text-ink-3">
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
              <p id="amount-help" className={`mt-1 text-[11px] ${amountCheck.ok ? "text-ink-3" : "text-rose-300"}`}>
                {amountCheck.ok ? `Up to 2 decimals · max ${MAX_AMOUNT_USDC.toLocaleString()} USDC` : amountCheck.error}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {AMOUNT_PRESETS.map((p) => (
                  <button key={p} type="button" onClick={() => setAmountInput(p)} aria-pressed={amountInput === p} className="chip font-num">
                    {p}
                  </button>
                ))}
                <button type="button" onClick={() => setAmountInput("")} className="chip" title="Clear amount">
                  Clear
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[12px] text-ink-3">
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
              <p id="slippage-help" className={`mt-1 text-[11px] ${slippageCheck.ok ? "text-ink-3" : "text-rose-300"}`}>
                {slippageCheck.ok ? `${(slippageCheck.value / 100).toFixed(2)}% · whole bps, 0–${MAX_SLIPPAGE_BPS}` : slippageCheck.error}
              </p>
            </div>
          </div>

          {/* Quote summary with its countdown; fees always visible */}
          {quote && (
            <div className="mt-4">
              <QuoteSummary
                quote={{
                  amountUsdc: quote.amountUsdc,
                  shares: quote.shares,
                  side: (quote.side || side) as "yes" | "no",
                  avgPrice: quote.avgPrice,
                  feeUsdc: quote.feeUsdc,
                }}
                slippageBps={slippageCheck.ok ? slippageCheck.value : null}
                secondsLeft={signature ? null : quoteSecondsLeft}
                totalSeconds={quoteTotalSeconds}
                ttlSource={deadline?.source ?? "panta"}
                stale={quoteStale && !signature}
              />
            </div>
          )}

          {/* The state notice: what happened, what is safe, the one next action */}
          <TradeStateNotice
            className="mt-4"
            state={tradeState}
            detail={error}
            meta={noticeMeta}
            signature={signature}
            onAction={na.onAction}
            actionDisabled={na.disabled}
            actionLabel={na.label}
          />

          {/* Review step: shown before the wallet is invoked */}
          {reviewOpen && build && quote && !signature && (
            <section aria-labelledby="review-title" className="mt-3 rounded-xl border border-blue-500/40 bg-blue-500/[0.06] p-4 animate-fade-in">
              <h3 id="review-title" className="text-[13px] font-semibold text-ink">
                Transaction details
              </h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
                <div className="col-span-2">
                  <dt className="text-ink-3">Market</dt>
                  <dd className="text-ink">{marketTitle}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Side</dt>
                  <dd className={`font-semibold ${build.side?.toLowerCase() === "no" ? "text-rose-300" : "text-emerald-300"}`}>
                    Buy {build.side?.toUpperCase() || side.toUpperCase()}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">Amount</dt>
                  <dd className="font-num text-ink">{build.amountUsdc} USDC</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Quote</dt>
                  <dd className="font-num text-ink">
                    ~{build.expectedShares} shares @ {quote.avgPrice}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">Fees</dt>
                  <dd className="font-num text-ink">{build.feeUsdc} USDC</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Wallet</dt>
                  <dd className="font-num text-ink">{shortAddr(publicKey?.toBase58(), 4)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Max slippage</dt>
                  <dd className="font-num text-ink">{slippageCheck.ok ? `${(slippageCheck.value / 100).toFixed(2)}%` : "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-ink-3">Programs</dt>
                  <dd className="text-ink-2">
                    {ixCheck?.ok ? `${ixCheck.count} instructions · ${ixCheck.programs.map(programLabel).join(", ")}` : "—"}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 flex gap-2 text-[12px] text-emerald-300/90">
                <span aria-hidden="true">✓</span> Checked: your wallet is the fee payer and only signer; every program is on the allowlist.
              </p>
              <p className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-[12px] leading-relaxed text-amber-100/90">
                Prediction markets involve risk and you can lose the full amount. Your wallet shows the transaction next;
                nothing is sent until you approve it there.
              </p>
              {mode === "guided" && (
                <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
                  <button type="button" className="btn btn-secondary" onClick={() => setReviewOpen(false)} disabled={busy}>
                    Back
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => void runApprove()} disabled={busy || quoteExpired}>
                    <IconWallet className="h-4 w-4" />
                    {quoteExpired ? "Quote expired" : "Approve in wallet"}
                  </button>
                </div>
              )}
            </section>
          )}

          {showStepper && (
            <div className="mt-3 rounded-xl border border-line bg-inset p-3.5">
              <p className="mb-3 text-[12px] font-semibold text-ink-2">Transaction progress</p>
              <TransactionStepper steps={steps} compact />
            </div>
          )}

          {signature && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
              <span className="font-addr break-all">
                Signature <span className="text-emerald-300">{shortAddr(signature, 8)}</span>
              </span>
              <button type="button" onClick={() => void copySig()} className="chip">
                Copy
              </button>
            </div>
          )}

          {toast && (
            <div role="status" className="mt-2 text-[12px] text-emerald-200">
              {toast}
            </div>
          )}

          {connected && mode === "manual" && (
            <div className={`mt-4 grid gap-2 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
              <button type="button" disabled={busy || !quoteInputsValid} onClick={() => void wrap(runQuote)()} className="btn btn-primary">
                1 · Quote
              </button>
              <button type="button" disabled={busy || !quote || !slippageCheck.ok || quoteExpired} onClick={() => void wrap(() => runBuild())()} className={btnGhost}>
                2 · Build + check
              </button>
              <button type="button" disabled={busy || !build || ixCheck?.ok !== true || quoteExpired || Boolean(signature)} onClick={() => void wrap(() => runSignBroadcast())()} className={btnGhost}>
                3 · Sign, send &amp; confirm
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
              <button type="button" disabled={busy || !signature || txPhase !== "confirmed"} onClick={() => void wrap(() => runAttribute())()} className={btnGhost}>
                6 · Report trade
              </button>
            </div>
          )}

          {connected && done && mode === "guided" && (
            <button type="button" disabled={busy || !quoteInputsValid} onClick={() => void runGetQuote()} className="btn btn-secondary mt-3 w-full">
              New quote
            </button>
          )}

          {connected && blockingHint && !busy && (
            <p className="mt-2 text-[12px] text-ink-3" role="status">
              {blockingHint}
            </p>
          )}

          <details className="mt-4 rounded-xl border border-line bg-inset">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[12px] font-medium text-ink-3 hover:text-ink">
              Advanced
            </summary>
            <div className="space-y-3 border-t border-line p-3">
              <label className="block text-[12px] text-ink-3">
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
              <p id="attr-ref-help" className="text-[11px] leading-relaxed text-ink-3">
                User-supplied attribution metadata, not an authenticated identity. Sent as Panta{" "}
                <span className="font-addr">userId</span> on quote, build, and report.
              </p>
              {!attrCheck.ok && <p className="text-[11px] text-rose-300">{attrCheck.error}</p>}
              {!compact && (
                <label className="block text-[12px] text-ink-3">
                  Paste market ID
                  <input
                    value={marketId}
                    onChange={(e) => setMarketId(e.target.value)}
                    placeholder="Market public key"
                    aria-label="Paste market ID"
                    className={`${inputCls} font-addr`}
                  />
                </label>
              )}
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-ink-3">Desk log</p>
                <ul className="max-h-36 space-y-1 overflow-y-auto font-addr text-[10px] text-ink-3">
                  {log.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                  {log.length === 0 && <li>Idle. Get a quote to open a session.</li>}
                </ul>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-medium text-ink-3">Last responses (raw)</p>
                <pre className="max-h-36 overflow-auto font-addr text-[10px] text-ink-3">
                  {JSON.stringify({ submitRaw, verifyRaw, tradeRaw, orderId: build?.orderId }, null, 2)}
                </pre>
              </div>
            </div>
          </details>
        </>
      )}
    </Panel>
  );
}
