"use client";

/**
 * Free community forecasting for a room's Panta market.
 *
 * Everything shown comes from the server: the forecast window (re-checked
 * against Panta server-side), the community forecast (mean of CURRENT
 * forecasts, one per wallet) and the wallet's own revisions. A submission is
 * shown as saved only after the server confirms it. The Panta market price
 * lives in the Market panel; nothing here is a market price or a trade.
 */

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { forecasterPath } from "@/lib/arena/public";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatFriendlyIst, marketLabel, shortAddr } from "@/lib/format";
import { useMarket } from "@/lib/data/hooks";
import {
  BUCKET_COUNT,
  REASONING_MAX,
  charLen,
  formatBpsPercent,
  markerPlacement,
  percentToBps,
  sliderKeyBps,
  snapSliderBps,
  type Consensus,
  type PublicForecast,
  type PublicRevision,
} from "@/lib/forecasts/domain";
import {
  submitForecastRequest,
  useApplyCommittedForecast,
  useInvalidateForecasts,
  useMyForecast,
  useRoomForecasts,
  type RoomForecastsResponse,
} from "@/lib/forecasts/client";
import { yourForecastMode } from "@/lib/forecasts/panel-mode";
import { ELIGIBILITY_TEXT, forecastEligibility, type ForecastEligibility, type PublicForecastWindow } from "@/lib/forecasts/window-public";
import { LIFECYCLE_LABEL } from "@/lib/panta/catalog";
import { RoomApiError, newIdempotencyKey, useInvalidateRooms, useRoomSession, verifyWalletOwnership } from "@/lib/rooms/client";
import type { Room } from "@/lib/rooms/domain";
import { Panel } from "../Panel";
import { WalletButton } from "../WalletButton";
import { ErrorState, Skeleton } from "../ui/States";
import { StatusBadge } from "../ui/StatusBadge";

const PAGE = 10;
const DEFAULT_BPS = 5000;

function isWalletRejection(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /reject|declin|cancel|denied/i.test(msg);
}

export function ForecastPanel({ room }: { room: Room }) {
  const [offset, setOffset] = useState(0);
  const forecasts = useRoomForecasts(room.slug, offset, PAGE);
  const session = useRoomSession();
  const sessionWallet = session.data?.wallet ?? null;
  const mine = useMyForecast(room.slug, sessionWallet);
  const market = useMarket(room.marketId);
  const question = market.data ? marketLabel(market.data) : null;

  const data = forecasts.data;
  const myCurrent = sessionWallet && mine.data?.wallet === sessionWallet ? mine.data.current : null;

  return (
    <Panel title="Forecasts" subtitle="Free · public · no money involved" id="forecasts" className="forecast-panel min-w-0">
      <div className="space-y-5">
        <WindowHeader question={question} window={data?.window ?? null} loading={forecasts.isPending} />

        {forecasts.isError && !data ? (
          <ErrorState
            title="Forecasts didn't load"
            description={forecasts.error instanceof RoomApiError ? forecasts.error.message : "Couldn't reach Brief Command."}
            onRetry={() => void forecasts.refetch()}
          />
        ) : !data ? (
          <div role="status" aria-label="Loading forecasts" className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : (
          <>
            <ConsensusCard consensus={data.consensus} mine={myCurrent} />
            <YourForecast room={room} data={data} sessionWallet={sessionWallet} sessionPending={session.isPending} mine={mine} />
            <PublicList
              data={data}
              sessionWallet={sessionWallet}
              onPage={(o) => setOffset(Math.max(0, o))}
              fetching={forecasts.isFetching}
            />
          </>
        )}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ header

function WindowHeader({ question, window, loading }: { question: string | null; window: PublicForecastWindow | null; loading: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-inset/40 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Question</p>
      <p className="mt-1 text-[15px] font-semibold leading-snug text-ink">{question ?? "Loading the market question from Panta…"}</p>
      <p className="mt-1 text-[12px] text-ink-3">Forecast the chance this resolves YES.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {window?.lifecycle ? <StatusBadge tone="neutral" size="xs">{LIFECYCLE_LABEL[window.lifecycle]}</StatusBadge> : null}
        {loading && !window ? (
          <StatusBadge tone="pending" size="xs">Checking forecast window…</StatusBadge>
        ) : window ? (
          <StatusBadge tone={forecastEligibility(window) === "open" ? "live" : "warning"} size="xs">
            {ELIGIBILITY_TEXT[forecastEligibility(window)]}
          </StatusBadge>
        ) : null}
        {window?.cutoffAt ? (
          <span className="font-num text-[12px] text-ink-2">
            {window.open ? "Closes" : "Cutoff"} {formatFriendlyIst(window.cutoffAt)}
          </span>
        ) : null}
      </div>
      {window && !window.open && window.message ? <p className="mt-2 text-[12px] leading-relaxed text-amber-100/90">{window.message}</p> : null}
      {window && forecastEligibility(window) === "open" ? (
        <p className="mt-2 text-[12px] text-ink-3">The cutoff is the end of Panta&apos;s primary buy window. Forecasts already made stay visible after it.</p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ consensus

function ConsensusCard({ consensus, mine }: { consensus: Consensus; mine: PublicForecast | null }) {
  const max = Math.max(1, ...consensus.buckets);
  const meanBps = consensus.kind === "consensus" ? consensus.meanBps : null;
  return (
    <section aria-labelledby="community-forecast-h" className="rounded-xl border border-violet-400/25 bg-gradient-to-br from-violet-500/[0.07] via-transparent to-cyan-400/[0.04] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="community-forecast-h" className="text-[13px] font-semibold text-ink-2">
          Community forecast
        </h3>
        <span className="text-[12px] text-ink-3">
          {consensus.participants} {consensus.participants === 1 ? "participant" : "participants"}
        </span>
      </div>
      {meanBps === null ? (
        <>
          <p className="mt-3 text-[15px] font-semibold text-ink-2">No community forecasts yet</p>
          <p className="mt-1 text-[12px] text-ink-3">The community forecast appears here after the first forecast: the average of each participant&apos;s current forecast. Free opinions, not Panta&apos;s market price.</p>
        </>
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
          <p className="font-num text-[34px] font-semibold leading-none text-ink">
            {formatBpsPercent(meanBps, 1)} <span className="text-[14px] font-medium text-emerald-300">YES</span>
          </p>
          {mine ? (
            <p className="text-[12px] text-ink-2">
              Yours: <span className="font-num font-semibold text-cyan-200">{formatBpsPercent(mine.probabilityBps)}</span>{" "}
              <span className="text-ink-3">({diffText(mine.probabilityBps - meanBps)})</span>
            </p>
          ) : null}
        </div>
      )}
      {meanBps !== null ? (
        <>
          <p className="mt-1 text-[11px] text-ink-3">Average of each participant&apos;s current forecast. Free opinions, not Panta&apos;s market price.</p>

          <div className="mt-6" role="img" aria-label={histogramLabel(consensus)}>
            <div className="relative flex h-20 items-end gap-1">
              {consensus.buckets.map((n, i) => (
                <div key={i} className="flex h-full flex-1 flex-col justify-end">
                  <div
                    className={`rounded-t ${n ? "bg-violet-400/60" : "bg-line/60"}`}
                    style={{ height: n ? `${Math.max(8, (n / max) * 100)}%` : "2px" }}
                    title={`${i * 10}–${i === BUCKET_COUNT - 1 ? 100 : i * 10 + 9.99}%: ${n}`}
                  />
                </div>
              ))}
              <Marker bps={meanBps} label="Avg" tone="violet" other={null} />
              {mine ? <Marker bps={mine.probabilityBps} label="You" tone="cyan" other={meanBps} /> : null}
            </div>
            <div className={`${mine && markerPlacement(mine.probabilityBps, meanBps).below ? "mt-5" : "mt-1"} flex justify-between font-num text-[10px] text-ink-3`} aria-hidden="true">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Marker({ bps, label, tone, other }: { bps: number; label: string; tone: "violet" | "cyan"; other: number | null }) {
  const color = tone === "violet" ? "bg-violet-200" : "bg-cyan-300";
  const text = tone === "violet" ? "text-violet-100" : "text-cyan-200";
  const { align, below } = markerPlacement(bps, other);
  const x = align === "start" ? "-translate-x-0.5" : align === "end" ? "-translate-x-full" : "-translate-x-1/2";
  return (
    <div className="pointer-events-none absolute inset-y-0" style={{ left: `${bps / 100}%` }} aria-hidden="true">
      <div className={`absolute inset-y-0 w-0.5 -translate-x-1/2 ${color}`} />
      <span className={`absolute ${below ? "-bottom-4" : "-top-4"} ${x} whitespace-nowrap text-[10px] font-semibold ${text}`}>{label}</span>
    </div>
  );
}

const diffText = (d: number) => (d === 0 ? "same as the community" : `${d > 0 ? "+" : "−"}${formatBpsPercent(Math.abs(d))} vs community`);

function histogramLabel(c: Consensus): string {
  if (c.kind === "empty") return "Distribution of forecasts: none yet.";
  const parts = c.buckets.map((n, i) => (n ? `${n} between ${i * 10} and ${i === BUCKET_COUNT - 1 ? 100 : i * 10 + 10} percent` : null)).filter(Boolean);
  return `Distribution of current forecasts: ${parts.join("; ")}.`;
}

// ------------------------------------------------------------------ your forecast

type MineQuery = ReturnType<typeof useMyForecast>;

function YourForecast({
  room,
  data,
  sessionWallet,
  sessionPending,
  mine,
}: {
  room: Room;
  data: RoomForecastsResponse;
  sessionWallet: string | null;
  sessionPending: boolean;
  mine: MineQuery;
}) {
  const { publicKey, connected, signMessage, wallet } = useWallet();
  const connectedAddr = publicKey?.toBase58() ?? null;
  const verified = Boolean(connectedAddr && sessionWallet === connectedAddr);
  const eligibility = forecastEligibility(data.window);
  const current = verified && mine.data?.wallet === sessionWallet ? mine.data.current : null;
  const history = verified && mine.data?.wallet === sessionWallet ? mine.data.history : [];
  const [editing, setEditing] = useState(false);
  const [savedNote, setSavedNote] = useState<{ revision: number; at: string } | null>(null);

  const mode = yourForecastMode({
    eligibility,
    connected: Boolean(connected && connectedAddr),
    sessionPending,
    verified,
    minePending: mine.isPending,
    mineError: mine.isError,
    hasCurrent: Boolean(current),
    editing,
  });

  let body: React.ReactNode;
  switch (mode) {
    case "closed":
      body = <ClosedSummary eligibility={eligibility} hasHistory={history.length > 0} />;
      break;
    case "closed-verify":
      body = (
        <div className="space-y-3">
          <ClosedSummary eligibility={eligibility} hasHistory={false} />
          <VerifyWallet purpose="history" connectedAddr={connectedAddr!} sessionWallet={sessionWallet} canSign={Boolean(signMessage)} walletName={wallet?.adapter.name ?? null} signMessage={signMessage} />
        </div>
      );
      break;
    case "connect":
      body = (
        <div className="flex flex-wrap items-center gap-3">
          <WalletButton />
          <span className="text-[12px] text-ink-3">Connect a wallet to forecast. It&apos;s free: no transaction, no funds.</span>
        </div>
      );
      break;
    case "session-loading":
      body = <Skeleton className="h-10 w-1/2" />;
      break;
    case "verify":
      body = <VerifyWallet purpose="forecast" connectedAddr={connectedAddr!} sessionWallet={sessionWallet} canSign={Boolean(signMessage)} walletName={wallet?.adapter.name ?? null} signMessage={signMessage} />;
      break;
    case "mine-loading":
      body = <Skeleton className="h-16 w-full" />;
      break;
    case "mine-error":
      body = <ErrorState title="Your forecast didn't load" description={mine.error instanceof RoomApiError ? mine.error.message : undefined} onRetry={() => void mine.refetch()} />;
      break;
    case "closed-current":
    case "current":
      body = (
        <div className="space-y-3">
          <CurrentForecastCard f={current!} focusOnMount={savedNote !== null && savedNote.revision === current!.revision} />
          {savedNote && savedNote.revision === current!.revision ? (
            <p role="status" className="text-[12px] text-emerald-200">
              Saved by the server · revision {savedNote.revision} at {formatFriendlyIst(savedNote.at)}
            </p>
          ) : null}
          {mode === "current" ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm forecast-tap"
              onClick={() => {
                setSavedNote(null);
                setEditing(true);
              }}
            >
              Edit forecast
            </button>
          ) : (
            <p className="text-[12px] text-ink-3">{ELIGIBILITY_TEXT[eligibility]}, so this forecast can no longer be edited. Its revision history stays below.</p>
          )}
        </div>
      );
      break;
    case "form":
      body = (
        <ForecastForm
          key={current ? `edit-${current.revision}` : "new"}
          room={room}
          current={current}
          walletAddr={connectedAddr!}
          disabledReason={null}
          onDone={(revision, at) => {
            setSavedNote({ revision, at });
            setEditing(false);
          }}
          onCancel={current ? () => setEditing(false) : undefined}
        />
      );
      break;
  }

  return (
    <section aria-labelledby="your-forecast-h" className="space-y-3 border-t border-line pt-4">
      <h3 id="your-forecast-h" className="text-[13px] font-semibold text-ink-2">
        Your forecast
      </h3>
      {body}
      {history.length ? <History history={history} /> : null}
    </section>
  );
}

/** Replaces the form whenever the server window isn't open (the reason is in the header above). */
function ClosedSummary({ eligibility, hasHistory }: { eligibility: ForecastEligibility; hasHistory: boolean }) {
  return (
    <div role="status" className="rounded-xl border border-line bg-inset/40 px-3 py-3 text-[12px] leading-relaxed text-ink-3">
      <p className="text-[13px] font-semibold text-ink-2">{ELIGIBILITY_TEXT[eligibility]} · nothing to submit</p>
      <p className="mt-1">{hasHistory ? "Your earlier revisions stay below." : "Forecasts already made stay visible below."}</p>
    </div>
  );
}

function VerifyWallet({
  purpose,
  connectedAddr,
  sessionWallet,
  canSign,
  walletName,
  signMessage,
}: {
  purpose: "forecast" | "history";
  connectedAddr: string;
  sessionWallet: string | null;
  canSign: boolean;
  walletName: string | null;
  signMessage: ((m: Uint8Array) => Promise<Uint8Array>) | undefined;
}) {
  const inval = useInvalidateRooms();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canSign || !signMessage) {
    return (
      <p role="alert" className="rounded-xl border border-amber-400/35 bg-amber-400/[0.08] px-3 py-3 text-[13px] text-amber-100">
        {walletName ?? "This wallet"} can&apos;t sign messages, which forecasting uses to prove wallet ownership. Connect Phantom or Solflare.
      </p>
    );
  }
  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyWalletOwnership(connectedAddr, signMessage, sessionWallet);
      await inval.session();
    } catch (e) {
      setError(isWalletRejection(e) ? "You declined the signature request. Nothing was signed." : e instanceof RoomApiError ? e.message : "The wallet couldn't sign the message. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      {sessionWallet && sessionWallet !== connectedAddr ? (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-[12px] text-amber-100/90">
          This browser is verified for {shortAddr(sessionWallet, 4)}, but {shortAddr(connectedAddr, 4)} is connected. {purpose === "forecast" ? "Verify the connected wallet to forecast with it." : "Sign in with the connected wallet to see its forecast history."}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={verify} disabled={busy}>
          {busy ? "Waiting for signature…" : purpose === "forecast" ? `Verify ${shortAddr(connectedAddr, 4)} to forecast` : `Sign in as ${shortAddr(connectedAddr, 4)} to see your forecast`}
        </button>
        <span className="text-[12px] text-ink-3">Signs a short sign-in message. No transaction, no funds.</span>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-[13px] text-rose-100">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CurrentForecastCard({ f, focusOnMount = false }: { f: PublicForecast; focusOnMount?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // After a save, move focus to the saved summary (keyboard / screen-reader users land on the result).
    if (focusOnMount) ref.current?.focus({ preventScroll: true });
  }, [focusOnMount]);
  return (
    <div ref={ref} tabIndex={-1} aria-label={`Your saved forecast: ${formatBpsPercent(f.probabilityBps)} YES, revision ${f.revision}`} className="rounded-xl border border-cyan-400/25 bg-cyan-400/[0.05] p-3 outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-num text-[22px] font-semibold text-ink">
          {formatBpsPercent(f.probabilityBps)} <span className="text-[12px] font-medium text-emerald-300">YES</span>
        </p>
        <p className="text-[11px] text-ink-3">
          Revision {f.revision} · updated <span className="font-num">{formatFriendlyIst(f.updatedAt)}</span>
        </p>
      </div>
      <SplitBar bps={f.probabilityBps} />
      {f.reasoning ? <p className="mt-2 whitespace-pre-line break-words text-[13px] leading-relaxed text-ink-2">{f.reasoning}</p> : null}
    </div>
  );
}

function SplitBar({ bps }: { bps: number }) {
  return (
    <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
      <div className="bg-emerald-400/80" style={{ width: `${bps / 100}%` }} />
      <div className="flex-1 bg-rose-400/60" />
    </div>
  );
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string; conflict?: boolean };

function ForecastForm({
  room,
  current,
  walletAddr,
  disabledReason,
  onDone,
  onCancel,
}: {
  room: Room;
  current: PublicForecast | null;
  walletAddr: string;
  disabledReason: string | null;
  onDone: (revision: number, at: string) => void;
  onCancel?: () => void;
}) {
  const ids = useId();
  const invalidate = useInvalidateForecasts(room.slug);
  const applyCommitted = useApplyCommittedForecast(room.slug);
  const [bps, setBps] = useState(current?.probabilityBps ?? DEFAULT_BPS);
  const [text, setText] = useState(formatPct(current?.probabilityBps ?? DEFAULT_BPS));
  const [reasoning, setReasoning] = useState(current?.reasoning ?? "");
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const attempt = useRef<{ fp: string; key: string } | null>(null);
  const disabled = disabledReason !== null;
  const textBps = percentToBps(text);
  const reasonLen = charLen(reasoning.trim());
  const tooLong = reasonLen > REASONING_MAX;
  const unchanged = current !== null && bps === current.probabilityBps && reasoning.trim() === current.reasoning;
  const busy = save.kind === "saving";

  const onSlider = (v: number) => {
    setBps(v);
    setText(formatPct(v));
  };
  const onSliderKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const next = sliderKeyBps(e.key, bps);
    if (next === null) return;
    e.preventDefault(); // our step (1 point), not the browser's
    onSlider(next);
  };
  const onText = (v: string) => {
    setText(v);
    const b = percentToBps(v);
    if (b !== null) setBps(b);
  };

  const submit = async () => {
    if (disabled || busy || textBps === null || tooLong || unchanged) return;
    const expectedRevision = current?.revision ?? 0;
    const fp = JSON.stringify([bps, reasoning.trim(), expectedRevision]);
    // Same payload (a retry after a timeout) reuses the key so the server replays instead of double-saving.
    if (!attempt.current || attempt.current.fp !== fp) attempt.current = { fp, key: newIdempotencyKey() };
    setSave({ kind: "saving" });
    try {
      const res = await submitForecastRequest(room.slug, { roomId: room.roomId, probabilityBps: bps, reasoning: reasoning.trim(), expectedRevision, idempotencyKey: attempt.current.key });
      attempt.current = null;
      // Server confirmed: put the committed forecast + community aggregate into the cache,
      // then return the panel to the read-only summary (no refetch wait, no stale flash).
      await applyCommitted(res);
      onDone(res.forecast.revision, res.forecast.updatedAt);
    } catch (e) {
      const conflict = e instanceof RoomApiError && e.code === "FORECAST_REVISION_CONFLICT";
      if (conflict) attempt.current = null;
      setSave({
        kind: "error",
        conflict,
        message: e instanceof RoomApiError ? e.message : "Couldn't save your forecast. Nothing was changed. Try again.",
      });
      if (e instanceof RoomApiError && (conflict || e.code === "FORECASTING_CLOSED")) void invalidate();
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      aria-describedby={`${ids}-notice`}
    >
      {disabled ? (
        <p role="status" className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-[12px] text-amber-100/90">
          {disabledReason}
        </p>
      ) : null}
      <fieldset disabled={disabled || busy} className="space-y-4 disabled:opacity-60">
        <div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label htmlFor={`${ids}-range`} className="text-[12px] font-semibold text-ink-2">
              Chance of YES
            </label>
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${ids}-pct`} className="sr-only">
                YES probability in percent
              </label>
              <input
                id={`${ids}-pct`}
                className="field forecast-field w-24 text-right font-num"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                value={text}
                onChange={(e) => onText(e.target.value)}
                onBlur={() => textBps !== null && setText(formatPct(textBps))}
                aria-invalid={textBps === null}
                aria-describedby={`${ids}-pct-help`}
              />
              <span className="text-[13px] text-ink-3">%</span>
            </div>
          </div>
          <input
            id={`${ids}-range`}
            type="range"
            min={0}
            max={10000}
            step={1}
            value={bps}
            onKeyDown={onSliderKey}
            onChange={(e) => onSlider(snapSliderBps(Number(e.target.value)))}
            className="forecast-range mt-3 w-full"
            aria-valuetext={`${formatBpsPercent(bps)} chance of YES`}
            style={{ ["--fill" as string]: `${bps / 100}%` }}
          />
          <div className="mt-1 flex justify-center text-[11px] text-ink-3 sm:justify-between">
            <span className="hidden sm:inline">NO certain · 0%</span>
            <span className="font-num text-ink-2">
              {formatBpsPercent(bps)} YES · {formatBpsPercent(10000 - bps)} NO
            </span>
            <span className="hidden sm:inline">100% · YES certain</span>
          </div>
          <p id={`${ids}-pct-help`} className={`mt-1 text-[11px] ${textBps === null ? "text-rose-300" : "text-ink-3"}`}>
            {textBps === null
              ? "Enter a number from 0 to 100 (up to two decimals)."
              : "Slide or use the arrow keys (1 point per press), or type an exact value down to 0.01%."}
          </p>
        </div>

        <div>
          <label htmlFor={`${ids}-why`} className="text-[12px] font-semibold text-ink-2">
            Reasoning <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <textarea
            id={`${ids}-why`}
            className="field forecast-field mt-1.5 min-h-[84px] w-full resize-y"
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            maxLength={REASONING_MAX * 2}
            placeholder="What evidence moves you? Shown publicly next to your forecast."
            aria-invalid={tooLong}
          />
          <p className={`mt-1 text-right font-num text-[11px] ${tooLong ? "text-rose-300" : "text-ink-3"}`}>
            {reasonLen}/{REASONING_MAX}
          </p>
        </div>
      </fieldset>

      <p id={`${ids}-notice`} className="rounded-lg border border-line bg-inset/50 px-3 py-2 text-[12px] leading-relaxed text-ink-3">
        Forecasts are <strong className="text-ink-2">public</strong> and shown with your shortened wallet address{" "}
        <span className="font-addr text-ink-2">{shortAddr(walletAddr, 4)}</span>, along with your reasoning and every revision. They&apos;re free: no
        transaction, no funds, no payout.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary forecast-tap" disabled={disabled || busy || textBps === null || tooLong || unchanged}>
          {busy ? "Saving…" : current ? "Save revision" : "Submit forecast"}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn-ghost btn-sm forecast-tap" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
        {unchanged ? <span className="text-[12px] text-ink-3">Change the probability or reasoning to save a revision.</span> : null}
      </div>
      <div aria-live="polite">
        {save.kind === "error" ? (
          <div role="alert" className="rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-[13px] text-rose-100">
            {save.message}
            {save.conflict ? <span className="mt-1 block text-[12px] text-rose-200/80">Your latest saved forecast has been reloaded above.</span> : null}
          </div>
        ) : null}
      </div>
    </form>
  );
}

const formatPct = (bps: number) => String(Number((bps / 100).toFixed(2)));

function History({ history }: { history: PublicRevision[] }) {
  const [openAll, setOpenAll] = useState(false);
  const shown = openAll ? history : history.slice(0, 5);
  return (
    <div className="rounded-xl border border-line p-3">
      <h4 className="text-[12px] font-semibold text-ink-2">Your revisions</h4>
      <p className="text-[11px] text-ink-3">Every change is kept. Nothing is deleted or rewritten.</p>
      <ol className="mt-2 space-y-2">
        {shown.map((r) => (
          <li key={r.revision} className="border-l-2 border-line pl-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-[11px] font-semibold text-ink-3">#{r.revision}</span>
              <span className="font-num text-[13px] font-semibold text-ink">{formatBpsPercent(r.probabilityBps)} YES</span>
              <span className="font-num text-[11px] text-ink-3">{formatFriendlyIst(r.createdAt)}</span>
            </div>
            {r.reasoning ? <p className="mt-0.5 whitespace-pre-line break-words text-[12px] leading-relaxed text-ink-2">{r.reasoning}</p> : null}
          </li>
        ))}
      </ol>
      {history.length > 5 ? (
        <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setOpenAll((v) => !v)}>
          {openAll ? "Show fewer" : `Show all ${history.length}`}
        </button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ public list

function PublicList({
  data,
  sessionWallet,
  onPage,
  fetching,
}: {
  data: RoomForecastsResponse;
  sessionWallet: string | null;
  onPage: (offset: number) => void;
  fetching: boolean;
}) {
  const from = data.total ? data.offset + 1 : 0;
  const to = data.offset + data.forecasts.length;
  const pages = useMemo(() => ({ prev: data.offset > 0, next: to < data.total }), [data.offset, to, data.total]);
  return (
    <section aria-labelledby="all-forecasts-h" className="border-t border-line pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="all-forecasts-h" className="text-[13px] font-semibold text-ink-2">
          Current forecasts
        </h3>
        {data.total ? (
          <span className="font-num text-[11px] text-ink-3">
            {from}–{to} of {data.total}
          </span>
        ) : null}
      </div>
      {!data.forecasts.length ? (
        <p className="mt-2 text-[12px] text-ink-3">Nobody has forecast this market in this room yet.</p>
      ) : (
        <ul className={`mt-2 divide-y divide-line ${fetching ? "opacity-70" : ""}`}>
          {data.forecasts.map((f) => (
            <li key={f.wallet} className="py-2.5">
              <div className="flex items-center gap-3">
                <Link href={forecasterPath(f.wallet)} className="font-addr text-[12px] text-ink-2 hover:text-cyan-300" title={f.wallet}>
                  {shortAddr(f.wallet, 4)}
                </Link>
                {f.wallet === sessionWallet ? <StatusBadge tone="live" size="xs">You</StatusBadge> : null}
                <div className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-line sm:block" aria-hidden="true">
                  <div className="h-full bg-emerald-400/70" style={{ width: `${f.probabilityBps / 100}%` }} />
                </div>
                <span className="ml-auto font-num text-[13px] font-semibold text-ink sm:ml-0 sm:w-16 sm:text-right">{formatBpsPercent(f.probabilityBps)}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-3">
                Revision {f.revision} · <span className="font-num">{formatFriendlyIst(f.updatedAt)}</span>
              </p>
              {f.reasoning ? <p className="mt-1 line-clamp-3 whitespace-pre-line break-words text-[12px] leading-relaxed text-ink-2">{f.reasoning}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {pages.prev || pages.next ? (
        <div className="mt-2 flex gap-2">
          <button type="button" className="btn btn-ghost btn-sm forecast-tap" disabled={!pages.prev || fetching} onClick={() => onPage(data.offset - data.limit)}>
            ← Newer
          </button>
          <button type="button" className="btn btn-ghost btn-sm forecast-tap" disabled={!pages.next || fetching} onClick={() => onPage(data.offset + data.limit)}>
            Older →
          </button>
        </div>
      ) : null}
    </section>
  );
}
