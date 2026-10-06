"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/data/hooks";
import { describeErr } from "@/lib/errors";
import { shortAddr } from "@/lib/format";
import { checkMainnet } from "@/lib/network";
import { checkSignatureOnce, confirmSignature } from "@/lib/solana";
import { pantaFetch } from "@/lib/panta/client";
import { fetchMarket } from "@/lib/panta/markets";
import { browserCreatedMarkets } from "@/lib/panta/created-markets";
import { marketHref } from "@/lib/panta/lifecycle";
import { formatUsdcBaseUnits, sessionStaleReason, type CreateSession, type RegisterReceipt } from "@/lib/panta/create-market";
import {
  CREATE_SIGNING_DISABLED_COPY,
  CREATE_SIGNING_ENABLED,
  WalletRejected,
  createMarketActions,
  type BroadcastResult,
  type SimulatedBuild,
  type VerifiedBuild,
} from "@/lib/panta/create-flow";
import { IllegalTransition, MAY_BE_BROADCAST, phaseForRecoveryStage, transition, type CreatePhase } from "@/lib/panta/create-machine";
import { browserRecoveryStore, type CreateRecoveryRecord } from "@/lib/panta/create-recovery";
import { lamportsToSol } from "@/lib/panta/create-simulation";
import { rawRpc } from "@/lib/panta/create-rpc";
import {
  CREATE_CATEGORIES,
  CREATE_LIMITS,
  IMAGE_ALLOWED_TYPES,
  ONCHAIN_TEXT_BUDGET,
  SOLANA_PACKET_BYTES,
  STANDARD_MIN_LEAD_SEC,
  createInputErrors,
  imageFileError,
  normalizeCreateForm,
  onChainTextBytes,
  questionGuidance,
  type CreateForm,
  type FieldErrors,
  timelineConfirmationError,
} from "@/lib/panta/create-rules";
import { Panel } from "../Panel";
import { StatusBadge } from "../ui/StatusBadge";

export const RESOLUTION_COPY =
  "Panta resolves markets using its resolution process against the declared sources of truth. Eligible resolutions are subject to Panta's dispute process.";
export const ROYALTY_COPY = "Creator royalties, if earned, become claimable according to Panta's market rules.";
/** No fee amounts in copy: the live quote is the only payment source. */
export const TIER_INFO_COPY = "Creation fees are determined by Panta. Your live quote below is authoritative.";
export const REVIEW_RESOLUTION_COPY = "Panta resolution process using the declared sources of truth";

const REVIEW_PHASES: ReadonlySet<CreatePhase> = new Set<CreatePhase>(["BUILT", "VALIDATED", "SIMULATED", "REVIEW", "BLOCKED", "WALLET_APPROVAL", "WALLET_REJECTED"]);
const POST_PHASES: ReadonlySet<CreatePhase> = new Set<CreatePhase>([
  "BROADCAST",
  "CONFIRMATION",
  "CONFIRMATION_UNCERTAIN",
  "CONFIRMED_ON_CHAIN",
  "CHAIN_FAILED",
  "EXPIRED",
  "REGISTER",
  "REGISTRATION_NEEDS_ATTENTION",
  "RETRY_REGISTER",
  "SUCCESS",
]);

const HOUR = 3600;
const pad = (n: number) => String(n).padStart(2, "0");
function toLocalInput(unix: number | null): string {
  if (unix == null || !Number.isFinite(unix)) return "";
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}
function suggestedTimes(type: string, nowSec: number) {
  const roundUp = (t: number) => Math.ceil(t / HOUR) * HOUR;
  if (type === "breaking") {
    const start = roundUp(nowSec + 2 * HOUR);
    return { startTime: start, endTime: start + 6 * HOUR, resolutionTime: start + 8 * HOUR };
  }
  const start = roundUp(nowSec + STANDARD_MIN_LEAD_SEC + HOUR);
  return { startTime: start, endTime: start + 7 * 24 * HOUR, resolutionTime: start + 7 * 24 * HOUR + 2 * HOUR };
}
function fmtWhen(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** Wall clock for the action layer (module-level so render stays pure). */
const wallClock = () => Date.now();
const noopSubscribe = () => () => {};
/** Page-lifetime: survives re-creation of the actions object (e.g. the wallet adapter's signTransaction identity changing). */
const SIGNED_CREATE_IDS = new Set<string>();

export function CreateMarketWorkspace() {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const queryClient = useQueryClient();
  const wallet = publicKey?.toBase58() ?? null;
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const [initialNow] = useState(() => Math.floor(Date.now() / 1000));
  const [form, setForm] = useState<Omit<CreateForm, "wallet">>(() => ({
    question: "",
    title: "",
    description: "",
    category: "",
    marketType: "standard",
    region: "Global",
    resolutionRule: "",
    sources: [""],
    imageUrl: "",
    ...suggestedTimes("standard", initialNow),
    eventInProgress: false,
  }));
  const [timesTouched, setTimesTouched] = useState(false);
  // Suggested defaults are not consent: the creator ticks this or edits a time before quoting.
  const [timelineConfirmed, setTimelineConfirmed] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [phase, setPhaseState] = useState<CreatePhase>("DEFINE");
  const phaseRef = useRef<CreatePhase>("DEFINE");
  const [session, setSession] = useState<CreateSession | null>(null);
  const [built, setBuilt] = useState<VerifiedBuild | null>(null);
  const [simulated, setSimulated] = useState<SimulatedBuild | null>(null);
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const [activeRecord, setActiveRecord] = useState<CreateRecoveryRecord | null>(null);
  const [receipt, setReceipt] = useState<RegisterReceipt | null>(null);
  /** Signature + durability as soon as the wallet signs (before the result returns). */
  const [live, setLive] = useState<{ signature: string; durable: boolean } | null>(null);
  const [indexing, setIndexing] = useState<null | "checking" | "indexed" | "waiting">(null);
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "upload" | "quote" | "build" | "simulate" | "sign" | "status" | "register" | "index">(null);
  const [now, setNow] = useState(() => Date.now());
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Deterministic transitions only (create-machine.ts); an illegal one is a bug and is surfaced, not applied. */
  const go = (to: CreatePhase) => {
    const next = transition(phaseRef.current, to);
    phaseRef.current = next;
    setPhaseState(next);
  };
  // Render-time resets (restore / stale) only set state; the ref follows here before any handler runs.
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const actions = useMemo(
    () =>
      createMarketActions({
        postPanta: async (path, body) => (await pantaFetch(path, { method: "POST", body })).data,
        postUpload: async (url, fd) => {
          const res = await fetch(url, { method: "POST", body: fd });
          const json: unknown = await res.json().catch(() => null);
          if (!res.ok) {
            const msg = (json as { error?: { message?: unknown } } | null)?.error?.message;
            throw new Error(typeof msg === "string" ? `Image upload failed: ${msg.slice(0, 120)}` : `Image upload failed (HTTP ${res.status}).`);
          }
          return json;
        },
        checkNetwork: () => checkMainnet(connection),
        rpc: connection,
        balances: connection,
        simulate: (params) => rawRpc(connection.rpcEndpoint, "simulateTransaction", params),
        signTransaction: signTransaction ? (tx) => signTransaction(tx) : undefined,
        sendRawTransaction: (bytes) => connection.sendRawTransaction(bytes, { skipPreflight: false, preflightCommitment: "confirmed" }),
        confirm: (sig, bh, lvbh) => confirmSignature(connection, sig, bh, lvbh),
        checkSignature: (sig, lvbh) => checkSignatureOnce(connection, sig, lvbh),
        recovery: browserRecoveryStore,
        invalidateAfterCreate: (marketId) => {
          void queryClient.invalidateQueries({ queryKey: qk.catalog() });
          void queryClient.invalidateQueries({ queryKey: qk.market(marketId) });
          void queryClient.invalidateQueries({ queryKey: ["positions"] });
          void queryClient.invalidateQueries({ queryKey: ["usdc"] });
          void queryClient.invalidateQueries({ queryKey: ["accountTrades"] });
        },
        now: wallClock,
        signedCreateIds: SIGNED_CREATE_IDS,
      }),
    [connection, signTransaction, queryClient],
  );

  const input = useMemo(() => normalizeCreateForm({ ...form, wallet }), [form, wallet]);
  const errors: FieldErrors = useMemo(() => createInputErrors(input, Math.floor(now / 1000)), [input, now]);
  const textBytes = onChainTextBytes(input);
  const timelineUnconfirmed = timelineConfirmationError({ confirmed: timelineConfirmed, edited: timesTouched });
  const tips = questionGuidance(input.question);

  // Unresolved creations for wallets other than the connected one (refresh banner). Server snapshot: none.
  const otherPendingRaw = useSyncExternalStore(noopSubscribe, () => browserRecoveryStore.wallets().join(","), () => "");
  const otherPending = otherPendingRaw ? otherPendingRaw.split(",").filter((w) => w !== wallet) : [];

  // Durable recovery: when a wallet connects, an unresolved creation for it takes over the page.
  if (wallet && wallet !== restoredFor) {
    setRestoredFor(wallet);
    const rec = browserRecoveryStore.load(wallet);
    if (rec && !MAY_BE_BROADCAST.has(phase)) {
      setActiveRecord(rec);
      setSession(null);
      setBuilt(null);
      setSimulated(null);
      setPhaseState(phaseForRecoveryStage(rec.stage));
      setNotice("A market creation from this wallet was sent earlier and is not finished. It is shown below — do not create it again.");
    }
  }

  // Tick while a quote is live (expiry countdowns, stale detection).
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session]);

  // Local object URL for the picked file (revoked when the file changes / unmount).
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  // Before signing only: any material change (inputs, wallet) or expiry discards quote, build, simulation and review.
  // Never after a signature exists (the transaction is frozen from then on).
  const staleReason = session && !MAY_BE_BROADCAST.has(phase) && phase !== "WALLET_APPROVAL" ? sessionStaleReason(session, input, wallet, now) : null;
  if (session && staleReason) {
    setSession(null);
    setBuilt(null);
    setSimulated(null);
    setPhaseState("DEFINE");
    setNotice(staleReason);
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(null);
  };
  const setType = (t: "standard" | "breaking") => {
    setForm((f) => ({ ...f, marketType: t, eventInProgress: false, ...(timesTouched ? {} : suggestedTimes(t, Math.floor(Date.now() / 1000))) }));
    // New suggestions replace whatever was confirmed: confirm again.
    if (!timesTouched) setTimelineConfirmed(false);
  };
  const setTime = (k: "startTime" | "endTime" | "resolutionTime", v: string) => {
    setTimesTouched(true);
    set(k, fromLocalInput(v));
  };

  const onPickFile = (f: File | null) => {
    set("imageUrl", "");
    if (!f) {
      setFile(null);
      return;
    }
    const bad = imageFileError(f);
    if (bad) {
      setFile(null);
      setError(bad);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFile(f);
  };

  const upload = async () => {
    if (!file) return;
    setBusy("upload");
    setError(null);
    try {
      const url = await actions.uploadImage(file);
      set("imageUrl", url);
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy(null);
    }
  };

  const backToDefine = () => {
    if (MAY_BE_BROADCAST.has(phaseRef.current) || phaseRef.current === "WALLET_APPROVAL") return;
    setSession(null);
    setBuilt(null);
    setSimulated(null);
    setError(null);
    phaseRef.current = "DEFINE";
    setPhaseState("DEFINE");
  };

  const requestQuote = async () => {
    setShowErrors(true);
    setNotice(null);
    setError(null);
    if (!wallet) {
      setVisible(true);
      return;
    }
    if (browserRecoveryStore.load(wallet)) {
      setError("A previous creation from this wallet is still unresolved. Resolve it before creating another.");
      return;
    }
    if (Object.keys(errors).length || timelineUnconfirmed) return;
    setBusy("quote");
    try {
      // One request per click; no automatic retry (INVALID_MARKET_PARAMS is shown, the user decides).
      const s = await actions.quote(input, { confirmed: timelineConfirmed, edited: timesTouched });
      setSession(s);
      setBuilt(null);
      setSimulated(null);
      setNow(wallClock());
      go("QUOTED");
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy(null);
    }
  };

  /** Build → validator → final check #1 → simulation → review. Any failure → BLOCKED (nothing signed). */
  const reviewCreation = async () => {
    if (!session) return;
    setError(null);
    setSimulated(null);
    setBusy("build");
    let b: VerifiedBuild;
    try {
      b = await actions.build(session, wallet);
    } catch (e) {
      setBuilt(null);
      setError(describeErr(e));
      safeGo("BLOCKED");
      setBusy(null);
      return;
    }
    setBuilt(b);
    safeGo("BUILT");
    safeGo("VALIDATED");
    setBusy("simulate");
    try {
      const sim = await actions.simulate({ session, build: b.build, currentInput: input, connectedWallet: wallet });
      setSimulated(sim);
      setNow(wallClock());
      safeGo("SIMULATED");
      safeGo("REVIEW");
    } catch (e) {
      setError(describeErr(e));
      safeGo("BLOCKED");
    } finally {
      setBusy(null);
    }
  };

  const safeGo = (to: CreatePhase) => {
    try {
      go(to);
    } catch (e) {
      if (e instanceof IllegalTransition) setError(e.message);
      else throw e;
    }
  };

  /** Final check #2 → wallet → exact-bytes check → persist → broadcast → confirm → register. */
  const approve = async () => {
    if (!session || !built || !simulated || phaseRef.current !== "REVIEW") return;
    setError(null);
    setBusy("sign");
    let res: BroadcastResult;
    try {
      res = await actions.approveAndBroadcast({
        session,
        build: built.build,
        currentInput: input,
        connectedWallet: wallet,
        simulated,
        onPhase: (p, info) => {
          if (info) setLive(info);
          safeGo(p);
        },
      });
    } catch (e) {
      setBusy(null);
      if (e instanceof WalletRejected) {
        safeGo("WALLET_REJECTED");
        return;
      }
      setError(describeErr(e));
      safeGo("BLOCKED");
      return;
    }
    setResult(res);
    setActiveRecord(res.record);
    await afterOutcome(res);
  };

  const afterOutcome = async (res: BroadcastResult) => {
    setResult(res);
    setActiveRecord(res.record);
    if (res.kind === "confirmed") {
      safeGo("CONFIRMED_ON_CHAIN");
      safeGo("REGISTER");
      await doRegister(res.record);
    } else {
      setBusy(null);
      safeGo(res.kind === "chain_failed" ? "CHAIN_FAILED" : res.kind === "expired" ? "EXPIRED" : "CONFIRMATION_UNCERTAIN");
    }
  };

  const doRegister = async (rec: CreateRecoveryRecord) => {
    setBusy("register");
    try {
      const r = await actions.registerFromRecord(rec);
      setReceipt(r);
      // Stage D: keep the checked receipt as "awaiting Panta indexing" evidence
      // for the catalog and /markets/{id} (pruned once Panta returns the market).
      browserCreatedMarkets.remember({ marketId: r.marketId, signature: r.signature, question: rec.question });
      safeGo("SUCCESS");
      void checkIndexedFor(r.marketId);
    } catch (e) {
      setError(describeErr(e));
      setActiveRecord(browserRecoveryStore.load(rec.wallet) ?? { ...rec, stage: "registration_needs_attention" });
      safeGo("REGISTRATION_NEEDS_ATTENTION");
    } finally {
      setBusy(null);
    }
  };

  const checkStatus = async () => {
    if (!activeRecord) return;
    setBusy("status");
    setError(null);
    try {
      const res = await actions.checkStatus(activeRecord);
      if (res.kind === "confirmed") {
        await afterOutcome(res);
        return;
      }
      setResult(res);
      safeGo(res.kind === "chain_failed" ? "CHAIN_FAILED" : res.kind === "expired" ? "EXPIRED" : "CONFIRMATION_UNCERTAIN");
    } catch (e) {
      setError(describeErr(e));
    } finally {
      setBusy((b) => (b === "status" ? null : b));
    }
  };

  /** Retry registration: same createId + signature; never quotes/builds/simulates/signs/broadcasts. */
  const registerNow = async () => {
    if (!activeRecord || phaseRef.current !== "REGISTRATION_NEEDS_ATTENTION") return;
    setError(null);
    safeGo("RETRY_REGISTER");
    await doRegister(activeRecord);
  };

  const checkIndexedFor = async (marketId: string) => {
    setIndexing("checking");
    try {
      const m = await fetchMarket(marketId);
      setIndexing(m ? "indexed" : "waiting");
      if (m) browserCreatedMarkets.prune([marketId]);
    } catch {
      setIndexing("waiting");
    }
  };
  const checkIndexed = async () => {
    if (receipt) await checkIndexedFor(receipt.marketId);
  };

  const startOver = () => {
    if (!["CHAIN_FAILED", "EXPIRED", "SUCCESS"].includes(phaseRef.current)) return;
    safeGo("DEFINE");
    setSession(null);
    setBuilt(null);
    setSimulated(null);
    setResult(null);
    setActiveRecord(null);
    setReceipt(null);
    setLive(null);
    setIndexing(null);
    setNotice(null);
    setError(null);
  };

  const err = (k: keyof FieldErrors) => (showErrors ? errors[k] : undefined);
  const buildExpiresMs = built ? Date.parse(built.build.expiresAt) : null;
  const buildExpired = buildExpiresMs != null && now >= buildExpiresMs - 5000;
  const canApprove = CREATE_SIGNING_ENABLED && phase === "REVIEW" && Boolean(simulated) && busy === null && !buildExpired && Boolean(signTransaction);
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Create</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.02em] text-ink">Create Market</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-3">
            Define a YES/NO market, get Panta&apos;s live creation quote, and review the exact transaction before your wallet is asked to sign.
            Brief Command never holds your keys.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="warning">MAINNET · REAL USDC</StatusBadge>
          <StatusBadge tone="warning">Market creation fees are non-refundable.</StatusBadge>
          <Link href="/desk" className="btn btn-secondary btn-sm">
            Back to desk
          </Link>
        </div>
      </div>

      <Stepper phase={phase} />

      <p className="text-[12px] text-ink-3">{TIER_INFO_COPY}</p>

      {otherPending.length ? (
        <div role="status" className="rounded-lg border border-amber-400/35 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-100">
          An unfinished market creation is saved in this browser for wallet {otherPending.map((w) => shortAddr(w)).join(", ")}. Connect that wallet to check or finish it.
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-lg border border-amber-400/35 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-100">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-[13px] text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:items-start">
        <div className="space-y-4">
          {phase === "DEFINE" && (
            <Panel title={<CardTitle title="1 · Define" sub="Every field is sent to Panta exactly as shown" />}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Question" required error={err("question")} className="sm:col-span-2" hint={`${input.question.length}/${CREATE_LIMITS.questionMax}`}>
                  <textarea
                    className="field field-example min-h-[68px]"
                    rows={2}
                    maxLength={CREATE_LIMITS.questionMax}
                    value={form.question}
                    aria-invalid={Boolean(err("question"))}
                    placeholder="e.g. Will the ECB cut its deposit rate at its 30 Oct 2026 meeting?"
                    onChange={(e) => set("question", e.target.value)}
                  />
                  {tips.length ? (
                    <ul className="mt-1.5 space-y-0.5 text-[12px] text-ink-3">
                      {tips.map((t) => (
                        <li key={t}>· {t}</li>
                      ))}
                    </ul>
                  ) : null}
                </Field>
                <Field label="Title" hint="Optional · defaults to the question" error={err("title")}>
                  <input className="field" maxLength={CREATE_LIMITS.titleMax} value={form.title} onChange={(e) => set("title", e.target.value)} />
                </Field>
                <Field label="Category" required error={err("category")}>
                  <select className="field capitalize" value={form.category} aria-invalid={Boolean(err("category"))} onChange={(e) => set("category", e.target.value)}>
                    <option value="">Choose…</option>
                    {CREATE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Description" hint="Optional · catalog context" className="sm:col-span-2" error={err("description")}>
                  <textarea className="field min-h-[60px]" rows={2} maxLength={CREATE_LIMITS.descriptionMax} value={form.description} onChange={(e) => set("description", e.target.value)} />
                </Field>

                <div className="sm:col-span-2">
                  <span className="text-[12px] font-medium text-ink-2">
                    Market type <span className="text-rose-300">*</span>
                  </span>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Market type">
                    <TypeCard
                      active={form.marketType === "standard"}
                      onClick={() => setType("standard")}
                      title="Standard"
                      body="Events at least 72 hours away. Longer primary phase before the event starts."
                    />
                    <TypeCard
                      active={form.marketType === "breaking"}
                      onClick={() => setType("breaking")}
                      title="Breaking"
                      body="Fast-moving events starting within 72 hours, or already under way."
                    />
                  </div>
                  {form.marketType === "breaking" ? (
                    <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-line bg-inset px-3 py-2.5 text-[13px] text-ink-2">
                      <input type="checkbox" className="mt-0.5" checked={form.eventInProgress} onChange={(e) => set("eventInProgress", e.target.checked)} />
                      <span>
                        <span className="font-medium text-ink">Event already in progress</span>
                        <span className="mt-0.5 block text-[12px] text-ink-3">
                          Tick only if the real-world event has already started. The start time must then be now or earlier and the end must still be in the
                          future. Leave it off for an event that starts later.
                        </span>
                      </span>
                    </label>
                  ) : null}
                </div>

                <Field label="Region" hint="Optional · defaults to Global" error={err("region")}>
                  <input className="field" maxLength={CREATE_LIMITS.regionMax} value={form.region} onChange={(e) => set("region", e.target.value)} />
                </Field>
                <div />

                <Field
                  label="Resolution rule"
                  required
                  className="sm:col-span-2"
                  error={err("resolutionRule")}
                  hint="Exactly when it resolves YES, and when NO"
                >
                  <textarea
                    className="field field-example min-h-[84px]"
                    rows={3}
                    maxLength={CREATE_LIMITS.ruleMax}
                    value={form.resolutionRule}
                    aria-invalid={Boolean(err("resolutionRule"))}
                    placeholder="e.g. YES if the ECB's official 30 Oct 2026 decision lowers the deposit rate; NO otherwise."
                    onChange={(e) => set("resolutionRule", e.target.value)}
                  />
                </Field>

                <div className="sm:col-span-2">
                  <span className="text-[12px] font-medium text-ink-2">
                    Sources of truth <span className="text-rose-300">*</span>
                  </span>
                  <p className="mt-0.5 text-[12px] text-ink-3">Public https pages Panta&apos;s resolution process can check. These are also the resolution evidence.</p>
                  <div className="mt-1.5 space-y-2">
                    {form.sources.map((s, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          className="field field-example"
                          inputMode="url"
                          value={s}
                          aria-label={`Source ${i + 1}`}
                          aria-invalid={Boolean(err("sources"))}
                          placeholder="e.g. https://www.ecb.europa.eu/press/…"
                          onChange={(e) => set("sources", form.sources.map((x, j) => (j === i ? e.target.value : x)))}
                        />
                        {form.sources.length > 1 ? (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("sources", form.sources.filter((_, j) => j !== i))} aria-label={`Remove source ${i + 1}`}>
                            Remove
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {form.sources.length < CREATE_LIMITS.sourcesUiMax ? (
                    <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => set("sources", [...form.sources, ""])}>
                      + Add source
                    </button>
                  ) : null}
                  {err("sources") ? <p className="mt-1 text-[12px] text-rose-300">{err("sources")}</p> : null}
                </div>

                <div className="sm:col-span-2">
                  <span className="text-[12px] font-medium text-ink-2">
                    Market image <span className="text-rose-300">*</span>
                  </span>
                  <div className="mt-1.5 flex flex-wrap items-start gap-3">
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-inset">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {form.imageUrl || preview ? <img src={form.imageUrl || preview || ""} alt="Market image preview" className="h-full w-full object-cover" /> : <span className="text-[11px] text-ink-3">No image</span>}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2 text-[12px] text-ink-3">
                      <input
                        ref={fileRef}
                        type="file"
                        accept={IMAGE_ALLOWED_TYPES.join(",")}
                        className="block w-full text-[12px] text-ink-2 file:mr-3 file:rounded-md file:border file:border-line file:bg-elevated file:px-3 file:py-1.5 file:text-ink"
                        onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                      />
                      <p>PNG, JPEG or WebP, up to 5 MB. Square 1024×1024 recommended. The file goes straight to Panta&apos;s image host.</p>
                      <div className="flex items-center gap-2">
                        <button type="button" className="btn btn-secondary btn-sm" disabled={!file || busy !== null || Boolean(form.imageUrl)} onClick={() => void upload()}>
                          {busy === "upload" ? "Uploading…" : form.imageUrl ? "Uploaded" : "Upload image"}
                        </button>
                        {form.imageUrl ? <StatusBadge tone="success" size="xs">Ready</StatusBadge> : null}
                      </div>
                      {err("imageUrl") ? <p className="text-rose-300">{err("imageUrl")}</p> : null}
                    </div>
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 text-[12px] font-medium text-ink-2">
                      <span>
                        Timeline <span className="text-rose-300">*</span>
                      </span>
                      {!timesTouched ? (
                        timelineConfirmed ? (
                          <span className="rounded-md border border-emerald-400/35 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">Suggested · confirmed</span>
                        ) : (
                          <span className="rounded-md border border-amber-400/35 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">Suggested — confirm</span>
                        )
                      ) : null}
                    </span>
                    <span className="text-[11px] text-ink-3">Your local time ({tz})</span>
                  </div>
                  <div className="mt-1.5 grid gap-3 sm:grid-cols-3">
                    <Field label="Start" error={showErrors || timesTouched ? errors.startTime : undefined}>
                      <input type="datetime-local" className="field" value={toLocalInput(form.startTime)} onChange={(e) => setTime("startTime", e.target.value)} />
                    </Field>
                    <Field label="End" error={showErrors || timesTouched ? errors.endTime : undefined}>
                      <input type="datetime-local" className="field" value={toLocalInput(form.endTime)} onChange={(e) => setTime("endTime", e.target.value)} />
                    </Field>
                    <Field label="Resolution" error={showErrors || timesTouched ? errors.resolutionTime : undefined}>
                      <input type="datetime-local" className="field" value={toLocalInput(form.resolutionTime)} onChange={(e) => setTime("resolutionTime", e.target.value)} />
                    </Field>
                  </div>
                  <p className="mt-1.5 text-[12px] text-ink-3">
                    {form.marketType === "standard"
                      ? "Standard: start at least 72 hours from now. Start before end; resolution at or after end."
                      : form.eventInProgress
                        ? "Breaking, already in progress: start now or earlier, end in the future."
                        : "Breaking: start between 1 hour and 72 hours from now."}{" "}
                    Panta&apos;s server makes the final check.
                  </p>
                  {!timesTouched ? (
                    <label className="mt-2 flex items-start gap-2.5 rounded-lg border border-line bg-inset px-3 py-2.5 text-[13px] text-ink-2">
                      <input type="checkbox" className="mt-0.5" checked={timelineConfirmed} onChange={(e) => setTimelineConfirmed(e.target.checked)} />
                      <span>
                        <span className="font-medium text-ink">I confirm this timeline</span>
                        <span className="mt-0.5 block text-[12px] text-ink-3">
                          These times are suggestions that show valid timing. Check them against the real event, edit any of them, or tick to accept them as they are.
                        </span>
                      </span>
                    </label>
                  ) : null}
                  {showErrors && timelineUnconfirmed ? <p className="mt-1 text-[12px] text-rose-300">{timelineUnconfirmed}</p> : null}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <div className="text-[12px] text-ink-3">
                  On-chain text{" "}
                  <span className={`font-num ${textBytes > ONCHAIN_TEXT_BUDGET ? "text-rose-300" : "text-ink-2"}`}>
                    {textBytes}/{ONCHAIN_TEXT_BUDGET} bytes
                  </span>
                  {errors.budget ? <span className="mt-0.5 block text-rose-300">{errors.budget}</span> : null}
                  {showErrors && errors.wallet ? <span className="mt-0.5 block text-rose-300">{errors.wallet}</span> : null}
                </div>
                {connected ? (
                  <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void requestQuote()}>
                    {busy === "quote" ? "Requesting quote…" : "Get creation quote"}
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => setVisible(true)}>
                    Connect wallet to quote
                  </button>
                )}
              </div>
            </Panel>
          )}

          {phase === "QUOTED" && session && (
            <Panel title={<CardTitle title="2 · Quote" sub="Live from Panta" />} action={<StatusBadge tone="warning" size="xs">MAINNET · REAL USDC</StatusBadge>}>
              <p className="text-[12px] text-ink-3">{TIER_INFO_COPY}</p>
              <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Row label="Creation payment" value={<span className="font-num text-[18px] font-semibold text-ink">{formatUsdcBaseUnits(session.paymentBase)} USDC</span>} />
                <Row label="Market type" value={<span className="capitalize">{session.marketType}</span>} />
                {session.liquidityBase != null ? <Row label="Liquidity allocation" value={<span className="font-num">{formatUsdcBaseUnits(session.liquidityBase)} USDC</span>} /> : null}
                {session.platformBase != null ? <Row label="Platform allocation" value={<span className="font-num">{formatUsdcBaseUnits(session.platformBase)} USDC</span>} /> : null}
                <Row label="Expected event address" value={<Mono>{session.expectedEventPda}</Mono>} wide />
                <Row label="Quote expires in" value={<span className="font-num">{clock(session.expiresAtMs - now)}</span>} />
              </dl>
              <div className="mt-4 rounded-lg border border-amber-400/35 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-100">
                Market creation fees are non-refundable.
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <button type="button" className="btn btn-ghost btn-sm" onClick={backToDefine}>
                  Edit details
                </button>
                <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void reviewCreation()}>
                  {busy === "build" ? "Building and verifying…" : busy === "simulate" ? "Simulating…" : "Review creation"}
                </button>
              </div>
            </Panel>
          )}

          {REVIEW_PHASES.has(phase) && session && (
            <Panel title={<CardTitle title="3 · Final review" sub="Check everything before your wallet opens" />}>
              <CreateReviewDetails
                session={session}
                simulated={simulated}
                buildExpiresMs={buildExpiresMs}
                now={now}
              />
              <p className="mt-3 text-[12px] text-ink-3">Market creation fees are non-refundable.</p>
              {phase === "WALLET_REJECTED" ? (
                <div className="mt-3 rounded-lg border border-line bg-inset px-3 py-2 text-[12px] text-ink-2">
                  Wallet request rejected. Nothing was signed or sent. Rebuild to review again.
                </div>
              ) : null}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null || phase === "WALLET_APPROVAL"} onClick={backToDefine}>
                    Edit details
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null || phase === "WALLET_APPROVAL"} onClick={() => void reviewCreation()}>
                    {busy === "build" ? "Rebuilding…" : busy === "simulate" ? "Simulating…" : buildExpired ? "Rebuild (expired)" : "Rebuild"}
                  </button>
                </div>
                <div className="flex w-full flex-col items-stretch gap-1 sm:w-auto sm:items-end">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!canApprove}
                    aria-disabled={!canApprove}
                    onClick={() => void approve()}
                  >
                    {phase === "WALLET_APPROVAL" ? "Waiting for wallet…" : busy === "sign" ? "Checking…" : "Approve in wallet"}
                  </button>
                  {!CREATE_SIGNING_ENABLED ? <span className="text-[11px] text-amber-200">{CREATE_SIGNING_DISABLED_COPY}</span> : null}
                  {phase === "REVIEW" && !simulated ? <span className="text-[11px] text-ink-3">Simulation required before approval.</span> : null}
                </div>
              </div>
            </Panel>
          )}

          {POST_PHASES.has(phase) && (
            <Panel
              title={<CardTitle title={postTitle(phase)} sub={phase === "SUCCESS" ? "Registered with Panta" : "Frozen transaction · never re-signed"} />}
            >
              <PostBroadcastPanel
                phase={phase}
                rec={activeRecord}
                live={live}
                result={result}
                receipt={receipt}
                indexing={indexing}
                busy={busy}
                onCheckStatus={() => void checkStatus()}
                onRegister={() => void registerNow()}
                onCheckIndexed={() => void checkIndexed()}
                onStartOver={startOver}
              />
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Before you create">
            <ul className="space-y-1.5 text-[13px] text-ink-2">
              <li>· Objective: the outcome is a fact, not an opinion.</li>
              <li>· Publicly verifiable from the sources you declare.</li>
              <li>· Unambiguous: one clear YES case and one clear NO case, with a date.</li>
              <li>· Legally permissible where you and your audience are.</li>
              <li>· Resolvable from the declared sources alone.</li>
            </ul>
            <p className="mt-3 text-[12px] text-ink-3">Brief Command checks format and timing only. It does not judge or guarantee market quality.</p>
          </Panel>
          <Panel title="Resolution">
            <p className="text-[13px] text-ink-2">{RESOLUTION_COPY}</p>
            <p className="mt-3 text-[12px] text-ink-3">{ROYALTY_COPY}</p>
          </Panel>
          <Panel title="How creation works">
            <ol className="space-y-1.5 text-[13px] text-ink-2">
              <li>1. Panta quotes the creation fee from its on-chain config.</li>
              <li>2. Panta builds an unsigned transaction for your wallet.</li>
              <li>3. Brief Command decodes and checks every account, amount and program, then simulates the exact transaction.</li>
              <li>4. You approve in your own wallet; then Panta registers the market.</li>
            </ol>
            <p className="mt-3 text-[12px] text-ink-3">Non-custodial: your keys never leave your wallet.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

const STEP_ORDER = ["Define", "Quote", "Review", "Wallet", "Broadcast", "Register"] as const;
function stepIndex(phase: CreatePhase): number {
  switch (phase) {
    case "DEFINE":
      return 0;
    case "QUOTED":
      return 1;
    case "BUILT":
    case "VALIDATED":
    case "SIMULATED":
    case "REVIEW":
    case "BLOCKED":
    case "WALLET_REJECTED":
      return 2;
    case "WALLET_APPROVAL":
      return 3;
    case "BROADCAST":
    case "CONFIRMATION":
    case "CONFIRMATION_UNCERTAIN":
    case "CHAIN_FAILED":
    case "EXPIRED":
      return 4;
    case "CONFIRMED_ON_CHAIN":
    case "REGISTER":
    case "REGISTRATION_NEEDS_ATTENTION":
    case "RETRY_REGISTER":
      return 5;
    case "SUCCESS":
      return 6;
  }
}

function Stepper({ phase }: { phase: CreatePhase }) {
  const at = stepIndex(phase);
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Create market steps">
      {STEP_ORDER.map((label, i) => {
        const state = i < at ? "done" : i === at ? "active" : "todo";
        return (
          <li key={label} className="flex items-center gap-1.5">
            <span
              aria-current={state === "active" ? "step" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] ${
                state === "active"
                  ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100"
                  : state === "done"
                    ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-100"
                    : "border-line bg-inset text-ink-3"
              }`}
            >
              <span className="font-num">{i + 1}</span> {label}
            </span>
            {i < STEP_ORDER.length - 1 ? <span className="h-px w-3 bg-line" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** ✓ only for checks this session actually performed (create-flow CreateChecks); otherwise "not run". */
export const CHECK_LABELS: readonly [keyof SimulatedBuild["checks"], string][] = [
  ["mainnet", "Mainnet verified"],
  ["binding", "Quote/build binding verified"],
  ["eventPda", "Event PDA verified"],
  ["payment", "Payment verified"],
  ["instruction", "Panta instruction verified"],
  ["accounts", "Account derivation verified"],
  ["size", "Transaction size verified"],
  ["tierPrice", "On-chain tier price verified"],
  ["simulation", "Simulation passed"],
];

export function CreateReviewDetails({ session, simulated, buildExpiresMs, now }: { session: CreateSession; simulated: SimulatedBuild | null; buildExpiresMs: number | null; now: number }) {
  const i = session.input;
  const sim = simulated?.sim ?? null;
  return (
    <>
      <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[12px] font-semibold tracking-wide text-amber-100">MAINNET · REAL USDC</div>
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Row label="Market question" value={i.question} wide />
        {i.title ? <Row label="Title" value={i.title} wide /> : null}
        <Row label="Type" value={<span className="capitalize">{session.marketType}</span>} />
        <Row label="Creation payment" value={<span className="font-num text-[16px] font-semibold text-ink">{formatUsdcBaseUnits(session.paymentBase)} USDC</span>} />
        {session.liquidityBase != null ? <Row label="Liquidity allocation" value={<span className="font-num">{formatUsdcBaseUnits(session.liquidityBase)} USDC</span>} /> : null}
        {session.platformBase != null ? <Row label="Platform allocation" value={<span className="font-num">{formatUsdcBaseUnits(session.platformBase)} USDC</span>} /> : null}
        <Row label="Creator wallet" value={<Mono>{i.wallet}</Mono>} wide />
        <Row label="Expected Event PDA" value={<Mono>{session.expectedEventPda}</Mono>} wide />
        <Row label="Timeline" value={`${fmtWhen(i.startTime)} → ${fmtWhen(i.endTime)} · resolves ${fmtWhen(i.resolutionTime)}`} wide />
        <Row label="Resolution" value={REVIEW_RESOLUTION_COPY} wide />
        <Row
          label="Sources"
          wide
          value={
            <ul className="space-y-0.5">
              {i.sourcesOfTruth.map((u) => (
                <li key={u} className="break-all">
                  {u}
                </li>
              ))}
            </ul>
          }
        />
        {sim ? (
          <Row
            label="Simulated effect on your wallet"
            wide
            value={
              <span className="font-num">
                USDC −{formatUsdcBaseUnits(-sim.usdcDelta)} (exact) · SOL −{lamportsToSol(sim.feeLamports + sim.rentLamports)} (network fee {lamportsToSol(sim.feeLamports)} + account rent {lamportsToSol(sim.rentLamports)})
              </span>
            }
          />
        ) : null}
        {simulated ? (
          <Row
            label="Balances checked"
            value={
              <span className="font-num">
                {formatUsdcBaseUnits(simulated.balances.usdcBase)} USDC · {lamportsToSol(simulated.balances.lamports)} SOL
              </span>
            }
            wide
          />
        ) : null}
        {buildExpiresMs != null ? <Row label="Transaction valid for" value={<span className="font-num">{clock(buildExpiresMs - now)}</span>} /> : null}
      </dl>
      <div className="mt-4 rounded-lg border border-line bg-inset p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-ink-2">Checks</span>
          <StatusBadge tone={simulated ? "success" : "warning"} size="xs">
            {simulated ? "All passed" : "Incomplete"}
          </StatusBadge>
        </div>
        <ul className="mt-2 grid gap-1 text-[12px] sm:grid-cols-2" aria-label="Pre-sign checks">
          {CHECK_LABELS.map(([k, label]) => {
            const ok = simulated?.checks[k] === true;
            return (
              <li key={k} className={ok ? "text-ink-2" : "text-ink-3"}>
                <span aria-hidden="true">{ok ? "✓" : "○"}</span> {label}
                {ok ? null : <span className="sr-only"> — not run</span>}
              </li>
            );
          })}
        </ul>
        {simulated ? (
          <p className="mt-2 text-[11px] text-ink-3">
            {simulated.verified.instructionCount} instructions · {simulated.verified.txBytes}/{SOLANA_PACKET_BYTES} bytes · {simulated.sim.unitsConsumed != null ? `${simulated.sim.unitsConsumed.toString()} CU simulated` : "simulated"}. All
            checks run again right before your wallet opens.
          </p>
        ) : null}
      </div>
    </>
  );
}

export function postTitle(phase: CreatePhase): string {
  switch (phase) {
    case "BROADCAST":
      return "Sending transaction";
    case "CONFIRMATION":
      return "Confirming on Solana";
    case "CONFIRMATION_UNCERTAIN":
      return "Confirmation pending";
    case "CHAIN_FAILED":
      return "Transaction failed on-chain";
    case "EXPIRED":
      return "Transaction expired";
    case "CONFIRMED_ON_CHAIN":
    case "REGISTER":
      return "Market transaction confirmed";
    case "REGISTRATION_NEEDS_ATTENTION":
    case "RETRY_REGISTER":
      return "Market transaction confirmed";
    case "SUCCESS":
      return "Market created";
    default:
      return "Market creation";
  }
}

export function PostBroadcastPanel({
  phase,
  rec,
  live,
  result,
  receipt,
  indexing,
  busy,
  onCheckStatus,
  onRegister,
  onCheckIndexed,
  onStartOver,
}: {
  phase: CreatePhase;
  rec: CreateRecoveryRecord | null;
  live: { signature: string; durable: boolean } | null;
  result: BroadcastResult | null;
  receipt: RegisterReceipt | null;
  indexing: null | "checking" | "indexed" | "waiting";
  busy: string | null;
  onCheckStatus: () => void;
  onRegister: () => void;
  onCheckIndexed: () => void;
  onStartOver: () => void;
}) {
  const signature = receipt?.signature ?? rec?.signature ?? live?.signature ?? null;
  const durable = result ? result.durable : (live?.durable ?? true);
  const tx = signature ? `https://solscan.io/tx/${signature}` : null;

  if (phase === "SUCCESS" && receipt) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="success">Market created</StatusBadge>
          {indexing === "waiting" ? <StatusBadge tone="warning" size="xs">Created successfully · waiting for Panta indexing</StatusBadge> : null}
          {indexing === "checking" ? <span className="text-[12px] text-ink-3">Checking Panta catalog…</span> : null}
        </div>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {receipt.title ?? rec?.title ? <Row label="Title" value={receipt.title ?? rec?.title} wide /> : null}
          {rec?.question ? <Row label="Question" value={rec.question} wide /> : null}
          <Row label="Market ID" value={<Mono>{receipt.marketId}</Mono>} wide />
          {rec ? <Row label="Type" value={<span className="capitalize">{rec.marketType}</span>} /> : null}
          {rec ? <Row label="Payment" value={<span className="font-num">{formatUsdcBaseUnits(BigInt(rec.paymentBase))} USDC</span>} /> : null}
          {rec ? <Row label="Creator wallet" value={<Mono>{rec.wallet}</Mono>} wide /> : null}
          <Row label="Transaction signature" value={<Mono>{receipt.signature}</Mono>} wide />
          <Row label="Registration" value={<span className="capitalize">{receipt.status}</span>} />
        </dl>
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Link href={marketHref(receipt.marketId)} className="btn btn-primary btn-sm">
            Open market
          </Link>
          {tx ? (
            <a href={tx} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
              View transaction
            </a>
          ) : null}
          {indexing === "waiting" ? (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={onCheckIndexed}>
              Check indexing
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onStartOver}>
            Create another
          </button>
        </div>
      </div>
    );
  }

  const needsAttention = phase === "REGISTRATION_NEEDS_ATTENTION" || phase === "RETRY_REGISTER";
  return (
    <div className="space-y-4">
      {phase === "BROADCAST" || phase === "CONFIRMATION" ? (
        <p className="text-[13px] text-ink-2">{phase === "BROADCAST" ? "Sending your signed transaction once…" : "Waiting for Solana confirmation. Don't close this page."}</p>
      ) : null}
      {phase === "CONFIRMED_ON_CHAIN" || phase === "REGISTER" ? <p className="text-[13px] text-ink-2">Market transaction confirmed. Registering with Panta…</p> : null}
      {phase === "CONFIRMATION_UNCERTAIN" ? (
        <div role="status" className="rounded-lg border border-amber-400/35 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-100">
          {result?.message ?? (rec?.lastError || "The outcome of your transaction is not known yet.")} Do not create this market again — check its status first.
        </div>
      ) : null}
      {phase === "CHAIN_FAILED" ? (
        <div role="alert" className="rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-[13px] text-rose-100">
          The transaction was processed but failed on-chain{result?.message ? ` (${result.message})` : ""}. No market was created and no USDC payment was taken; the network fee was spent.
        </div>
      ) : null}
      {phase === "EXPIRED" ? (
        <div role="alert" className="rounded-lg border border-line bg-inset px-3 py-2 text-[13px] text-ink-2">
          The transaction expired before landing and the market&apos;s event account does not exist. Nothing was created. You can start a new creation.
        </div>
      ) : null}
      {needsAttention ? (
        <div role="status" className="space-y-1 rounded-lg border border-amber-400/35 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-100">
          <p className="font-medium">Market transaction confirmed</p>
          <p>Panta registration needs attention. Your market exists on-chain; retrying only re-sends the same registration — nothing is signed or paid again.</p>
          {rec?.lastError ? <p className="text-[12px] text-amber-200/90">Last error: {rec.lastError}</p> : null}
        </div>
      ) : null}
      {!durable ? (
        <div role="alert" className="rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-[12px] text-rose-100">
          This browser could not save the recovery record. Copy the signature below before leaving this page.
        </div>
      ) : null}
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rec ? <Row label="Market question" value={rec.question} wide /> : null}
        {signature ? <Row label="Transaction signature" value={<Mono>{signature}</Mono>} wide /> : null}
        {rec ? <Row label="Expected Event PDA" value={<Mono>{rec.expectedEventPda}</Mono>} wide /> : null}
        {rec ? <Row label="Create ID" value={<Mono>{rec.createId}</Mono>} wide /> : null}
      </dl>
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {phase === "CONFIRMATION_UNCERTAIN" ? (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={onCheckStatus}>
            {busy === "status" ? "Checking…" : "Check status"}
          </button>
        ) : null}
        {needsAttention ? (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null || phase === "RETRY_REGISTER"} onClick={onRegister}>
            {phase === "RETRY_REGISTER" || busy === "register" ? "Retrying…" : "Retry registration"}
          </button>
        ) : null}
        {tx ? (
          <a href={tx} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
            View transaction
          </a>
        ) : null}
        {phase === "CHAIN_FAILED" || phase === "EXPIRED" ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onStartOver}>
            Start over
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Card heading with a subtitle that wraps under the title (the shared Panel subtitle truncates on narrow screens). */
function CardTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <span className="block">
      <span className="block">{title}</span>
      <span className="mt-0.5 block text-[12px] font-normal tracking-normal text-ink-3">{sub}</span>
    </span>
  );
}

function Field({ label, required, hint, error, className = "", children }: { label: string; required?: boolean; hint?: string; error?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="flex items-baseline justify-between gap-2 text-[12px] font-medium text-ink-2">
        <span>
          {label} {required ? <span className="text-rose-300">*</span> : null}
        </span>
        {hint ? <span className="font-normal text-ink-3">{hint}</span> : null}
      </span>
      <span className="mt-1 block">{children}</span>
      {error ? <span className="mt-1 block text-[12px] text-rose-300">{error}</span> : null}
    </label>
  );
}

function TypeCard({ active, onClick, title, body }: { active: boolean; onClick: () => void; title: string; body: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`rounded-lg border px-3 py-2.5 text-left transition ${active ? "border-blue-500/60 bg-blue-500/10" : "border-line bg-inset hover:border-line-strong"}`}
    >
      <span className="text-[13px] font-semibold text-ink">{title}</span>
      <span className="mt-0.5 block text-[12px] text-ink-3">{body}</span>
    </button>
  );
}

function Row({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[11px] uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-ink-2">{value}</dd>
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="break-all font-mono text-[12px] text-ink">{children}</span>;
}
