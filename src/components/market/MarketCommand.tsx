"use client";

/**
 * Market command-centre sections (Stage D): canonical state strip, the
 * connected wallet's position + activity + verification on this market, and
 * the created-market states (awaiting indexing / registration needs attention).
 * Everything shown comes from Panta (positions, tape, ledger) or this tab's
 * confirmed trade record; nothing is inferred from quotes.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useAccountTrades, useMarketTrades, usePositions } from "@/lib/data/hooks";
import { useRefreshTradeState, useSessionTrades } from "@/lib/data/reconcile";
import type { SessionTrade } from "@/lib/data/trade-session";
import { describeErr } from "@/lib/errors";
import { shortAddr } from "@/lib/format";
import type { Market, Position } from "@/lib/panta/domain";
import { isPantaIndexed, marketHref, type MarketState } from "@/lib/panta/lifecycle";
import { awaitingIndexing, browserCreatedMarkets } from "@/lib/panta/created-markets";
import { useCreateEvidence } from "@/lib/data/created";
import {
  ATTRIBUTION_LABEL,
  TX_LABEL,
  VERIFICATION_LABEL,
  buildMarketActivity,
  type MarketActivityItem,
} from "@/lib/panta/market-activity";
import { bookMark } from "@/lib/panta/position-value";
import { formatMarkUsdc, markSourceLabel } from "@/lib/panta/position-intel";
import { marketProbability } from "@/lib/panta/prices";
import { PANTA_USDC_PROGRAM_ID as PANTA_PROGRAM_ID } from "@/lib/panta/instructions";
import { Panel } from "../Panel";
import { StatusBadge, type StatusTone } from "../ui/StatusBadge";

const SOLSCAN_TX = (sig: string) => `https://solscan.io/tx/${sig}`;

function fmtTime(sec?: number | null): string | null {
  if (!sec) return null;
  return `${new Date(sec * 1000).toLocaleString("en-IN", {
    timeZone: "Asia/Calcutta",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })} IST`;
}

function fmtMs(ms: number | null): string {
  if (!ms) return "—";
  return `${new Date(ms).toLocaleString("en-IN", {
    timeZone: "Asia/Calcutta",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })} IST`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="min-h-7 rounded-md border border-line px-1.5 text-[11px] text-ink-3 hover:text-ink"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

// ------------------------------------------------------------- state strip

/** One line under the title: canonical state, what it means, and the timing that matters. */
export function MarketStateStrip({ state, market }: { state: MarketState; market: Market }) {
  const timing: string[] = [];
  const buyCloses = fmtTime(market.primaryPhaseEndTime);
  const ends = fmtTime(market.endTime);
  const resolves = fmtTime(market.resolutionTime);
  if (state.kind === "active" && state.lifecycle === "open" && buyCloses) timing.push(`Buy window closes ${buyCloses}`);
  if ((state.kind === "active" || state.kind === "quote_unavailable") && ends) timing.push(`Event ends ${ends}`);
  if (state.kind === "closed") {
    if (ends) timing.push(`Ended ${ends}`);
    if (resolves) timing.push(`Result expected ${resolves}`);
  }
  if (state.kind === "resolved" && resolves) timing.push(`Resolution time ${resolves}`);
  return (
    <div className="rounded-xl border border-line bg-inset/50 px-3 py-2.5" data-market-state={state.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={state.tone as StatusTone} size="sm">
          {state.label}
        </StatusBadge>
        {timing.length ? <span className="type-meta font-num">{timing.join(" · ")}</span> : null}
      </div>
      <p className="mt-1.5 text-[12px] text-ink-3">{state.detail}</p>
    </div>
  );
}

// ------------------------------------------------------------- your position + activity

const VERIFY_TONE: Record<MarketActivityItem["verification"], StatusTone> = {
  verified: "success",
  verifying: "pending",
  verify_slow: "pending",
  verify_failed: "error",
  mismatch: "error",
  not_checked: "neutral",
};

function PositionBlock({
  rows,
  loading,
  error,
  pending,
  stale,
  market,
}: {
  rows: Position[];
  loading: boolean;
  error: string | null;
  pending: SessionTrade | null;
  stale: SessionTrade | null;
  market: Market;
}) {
  const px = marketProbability(market);
  return (
    <div>
      <h3 className="type-col mb-2">Your position</h3>
      {error ? (
        <p className="text-[12px] text-amber-200/90" role="status">
          Position data unavailable · {error}
        </p>
      ) : loading && rows.length === 0 ? (
        <p className="text-[12px] text-ink-3">Loading position from Panta…</p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] text-ink-3">
          {pending || stale ? "No position reported by Panta yet." : "No position on this market."}
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((p, i) => {
            const mk = bookMark(p, px);
            return (
              <li key={`${p.side}-${i}`} className="rounded-lg border border-line bg-inset/40 px-3 py-2">
                <p className={`text-[11px] font-semibold uppercase ${p.side === "yes" ? "text-emerald-300" : p.side === "no" ? "text-rose-300" : "text-ink-3"}`}>
                  {p.side ?? "Side unknown"}
                </p>
                <p className="font-num text-[15px] text-ink">{p.shares || "—"} shares</p>
                <p className="font-num text-[11px] text-ink-3" title={mk.note}>
                  {mk.value != null ? `Mark ${formatMarkUsdc(mk.value)} · ${markSourceLabel(mk)}` : "Mark unavailable"}
                  {p.claimed ? " · Claimed" : p.claimable ? " · Claimable" : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {pending ? (
        <p className="mt-2 rounded-lg border border-cyan-400/25 bg-cyan-400/[0.06] px-3 py-2 text-[12px] text-cyan-100/90" role="status">
          Refresh pending · your {pending.side.toUpperCase()} trade is confirmed on Solana, and Panta hasn&apos;t indexed it into positions yet. Shares update from Panta, never from the quote.
        </p>
      ) : stale ? (
        <p className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-[12px] text-amber-100/90" role="status">
          Position may be stale · Panta hadn&apos;t reflected your confirmed trade after several checks. Use Refresh in a moment.
        </p>
      ) : null}
    </div>
  );
}

function VerificationDetails({ item }: { item: MarketActivityItem }) {
  const rows: [string, React.ReactNode][] = [
    ["Signature", <span key="s" className="break-all font-addr">{item.signature}</span>],
    ["Expected market", item.expected ? <span key="m" className="break-all font-addr">{item.expected.marketId}</span> : "— (not from this session)"],
    ["Expected side · amount", item.expected ? `${item.expected.side.toUpperCase()} · ${item.expected.amountUsdc.toFixed(2)} USDC` : "—"],
    ["Panta program", <span key="p" className="break-all font-addr">{PANTA_PROGRAM_ID}</span>],
    ["On-chain", TX_LABEL[item.tx]],
    ["Panta verification", VERIFICATION_LABEL[item.verification]],
    ["Attribution", item.ledgerStatus ? `${ATTRIBUTION_LABEL[item.attribution]} (${item.ledgerStatus})` : ATTRIBUTION_LABEL[item.attribution]],
  ];
  return (
    <dl className="mt-2 grid gap-1.5 rounded-lg border border-line bg-inset/40 p-3 text-[12px]">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-0.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 text-ink-2">{v}</dd>
        </div>
      ))}
      {item.mismatchReason ? <p className="text-[12px] text-rose-300">{item.mismatchReason}</p> : null}
      {item.verification === "not_checked" && !item.sources.session ? (
        <p className="text-[11px] text-ink-3">
          Panta order verification runs in the tab that placed the trade. This row is confirmed by Panta&apos;s index of the on-chain trade.
        </p>
      ) : null}
    </dl>
  );
}

function ActivityRow({ item }: { item: MarketActivityItem }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2.5" data-activity-sig={item.signature}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`text-[12px] font-semibold uppercase ${item.side === "yes" ? "text-emerald-300" : item.side === "no" ? "text-rose-300" : "text-ink-3"}`}>
          Buy {item.side ?? "—"}
        </span>
        <span className="font-num text-[12px] text-ink-2">{item.amountUsdc != null ? `${item.amountUsdc.toFixed(2)} USDC` : "—"}</span>
        <span className="font-num text-[12px] text-ink-2">
          {item.shares != null ? `${item.shares} shares` : <span className="text-ink-3">shares pending Panta index</span>}
        </span>
        <span className="type-meta font-num">{fmtMs(item.timeMs)}</span>
        {item.sources.session ? <span className="type-meta">· this session</span> : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <StatusBadge tone={item.tx === "indexed" ? "success" : "info"} size="xs">
          {item.tx === "indexed" ? "Confirmed · indexed" : "Confirmed · not indexed yet"}
        </StatusBadge>
        <StatusBadge tone={VERIFY_TONE[item.verification]} size="xs">
          {VERIFICATION_LABEL[item.verification]}
        </StatusBadge>
        {item.attribution === "attributed" || item.attribution === "reported" ? (
          <StatusBadge tone={item.attribution === "attributed" ? "info" : "pending"} size="xs">
            {ATTRIBUTION_LABEL[item.attribution]}
          </StatusBadge>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          <a
            href={SOLSCAN_TX(item.signature)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-7 items-center font-num text-[11px] text-cyan-300 hover:underline"
            title={`${item.signature} · open in Solscan`}
          >
            {shortAddr(item.signature, 6)} ↗
          </a>
          <CopyButton text={item.signature} label="Copy signature" />
          <button
            type="button"
            className="min-h-7 rounded-md border border-line px-1.5 text-[11px] text-ink-3 hover:text-ink"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide check" : "Verify"}
          </button>
        </span>
      </div>
      {open ? <VerificationDetails item={item} /> : null}
    </li>
  );
}

/** "You on this market": position (Panta), recent trades + verification. */
export function YourMarketPanel({ market }: { market: Market }) {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const wallet = publicKey ? publicKey.toBase58() : null;
  const positionsQ = usePositions(wallet);
  const tapeQ = useMarketTrades(market.marketId);
  const ledgerQ = useAccountTrades(50, "");
  const session = useSessionTrades(market.marketId, wallet);
  const refresh = useRefreshTradeState();

  if (!wallet) {
    return (
      <Panel title="Your position">
        <p className="text-[13px] text-ink-3">Wallet not connected. Connect to see your shares and trades on this market.</p>
        <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setVisible(true)}>
          Connect wallet
        </button>
      </Panel>
    );
  }

  const rows = (positionsQ.data ?? []).filter((p) => p.marketId === market.marketId);
  const pending = session.find((t) => t.reconcile === "pending") ?? null;
  const stale = pending ? null : (session.find((t) => t.reconcile === "stale") ?? null);
  const items = buildMarketActivity({
    marketId: market.marketId,
    wallet,
    tape: tapeQ.data?.trades,
    ledger: ledgerQ.data?.items ?? (ledgerQ.isError ? null : undefined),
    session,
  }).slice(0, 8);
  const busy = positionsQ.isFetching || tapeQ.isFetching || ledgerQ.isFetching;

  return (
    <Panel
      title="Your position & trades"
      subtitle={shortAddr(wallet, 4)}
      action={
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => refresh(market.marketId, wallet)}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <div className="space-y-4">
        <PositionBlock
          rows={rows}
          loading={positionsQ.isPending}
          error={positionsQ.error ? describeErr(positionsQ.error) : null}
          pending={pending}
          stale={stale}
          market={market}
        />
        <div>
          <h3 className="type-col mb-1">Your trades on this market</h3>
          {tapeQ.isError && ledgerQ.isError && session.length === 0 ? (
            <p className="text-[12px] text-amber-200/90">Activity unavailable · Panta&apos;s tape and ledger didn&apos;t answer.</p>
          ) : items.length === 0 ? (
            <p className="text-[12px] text-ink-3">
              {tapeQ.isPending ? "Loading trades…" : "No trades from this wallet in Panta's latest tape for this market."}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((it) => (
                <ActivityRow key={it.signature} item={it} />
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-ink-3">
            Shares come from Panta&apos;s tape and positions. &ldquo;Verified&rdquo; means Panta&apos;s order verification confirmed a trade placed in this session.{" "}
            <Link href="/book" className="text-cyan-300 hover:underline">
              All activity →
            </Link>
          </p>
        </div>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------- created-market states

export function AwaitingIndexingView({
  marketId,
  signature,
  question,
  checking,
  onCheck,
}: {
  marketId: string;
  signature: string | null;
  question: string | null;
  checking: boolean;
  onCheck: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <Panel title="Created successfully · waiting for Panta indexing">
        <p className="text-[13px] text-ink-2">
          Panta registered this market, but its catalog doesn&apos;t list it yet. Trading opens here once Panta indexes it. Nothing about it is shown until then.
        </p>
        <dl className="mt-3 grid gap-2 text-[12px]">
          {question ? (
            <div>
              <dt className="text-ink-3">Question</dt>
              <dd className="text-ink-2">{question}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-ink-3">Market ID</dt>
            <dd className="break-all font-addr text-ink-2">{marketId}</dd>
          </div>
          {signature ? (
            <div>
              <dt className="text-ink-3">Create transaction</dt>
              <dd className="break-all font-addr text-ink-2">
                <a href={SOLSCAN_TX(signature)} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">
                  {signature}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={checking} onClick={onCheck}>
            {checking ? "Checking Panta…" : "Check again"}
          </button>
          <Link href="/desk" className="btn btn-ghost btn-sm">
            ← Markets
          </Link>
        </div>
      </Panel>
    </div>
  );
}

/** Trading slot while a created market is registered but not yet indexed by Panta. */
export function AwaitingIndexingNote({ onCheck, checking }: { onCheck: () => void; checking: boolean }) {
  return (
    <Panel title="Created successfully · waiting for Panta indexing">
      <p className="text-[13px] text-ink-2">
        Panta registered this market and hasn&apos;t indexed it yet, so it can&apos;t be quoted. The ticket appears here once Panta returns the market.
      </p>
      <button type="button" className="btn btn-secondary btn-sm mt-3" disabled={checking} onClick={onCheck}>
        {checking ? "Checking Panta…" : "Check again"}
      </button>
    </Panel>
  );
}

/** Catalog notice: created markets Panta hasn't indexed yet + registrations needing attention. */
export function CreatedMarketsNotice({ catalog, loaded }: { catalog: readonly Market[]; loaded: boolean }) {
  const ev = useCreateEvidence();
  const indexedIds = new Set(catalog.filter((m) => isPantaIndexed(m)).map((m) => m.marketId));
  const pending = loaded ? awaitingIndexing(ev.created, indexedIds) : [];
  const attention = ev.needsAttention.filter((r) => !indexedIds.has(r.expectedEventPda));
  const indexedKey = ev.created.filter((r) => indexedIds.has(r.marketId)).map((r) => r.marketId).join(",");
  useEffect(() => {
    if (indexedKey) browserCreatedMarkets.prune(indexedKey.split(","));
  }, [indexedKey]);
  if (!ev.ready || (pending.length === 0 && attention.length === 0)) return null;
  return (
    <div className="space-y-2" data-created-notice>
      {pending.map((r) => (
        <div key={r.marketId} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-inset/50 px-3 py-2.5">
          <StatusBadge tone="pending" size="xs">
            Created successfully · waiting for Panta indexing
          </StatusBadge>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2" title={r.question ?? r.marketId}>
            {r.question || shortAddr(r.marketId, 6)}
          </span>
          <Link href={marketHref(r.marketId)} className="btn btn-ghost btn-sm">
            Check status
          </Link>
        </div>
      ))}
      {attention.map((r) => (
        <div key={r.expectedEventPda} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2.5">
          <StatusBadge tone="warning" size="xs">
            Registration needs attention
          </StatusBadge>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2" title={r.question}>
            {r.question}
          </span>
          <Link href="/create" className="btn btn-secondary btn-sm">
            Finish on Create
          </Link>
        </div>
      ))}
    </div>
  );
}

export function RegistrationNeedsAttention({ marketId }: { marketId: string }) {
  return (
    <Panel title="Registration needs attention">
      <p className="text-[13px] text-ink-2">
        This market&apos;s create transaction is confirmed, but Panta registration isn&apos;t finished. It can&apos;t be traded until Panta registers and indexes it.
      </p>
      <p className="mt-2 break-all font-addr text-[11px] text-ink-3">marketId: {marketId}</p>
      <Link href="/create" className="btn btn-primary btn-sm mt-3">
        Finish registration on Create
      </Link>
    </Panel>
  );
}
