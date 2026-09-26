"use client";

import { useState, type ReactNode } from "react";
import type { BriefMode, BriefPayload, Market } from "@/lib/types";
import type { MarketSignals } from "@/lib/panta/signals";
import { BRIEF_MODES, BRIEF_RATE_LIMIT } from "@/lib/brief-modes";
import { BriefRateLimitError, useBrief } from "@/lib/data/hooks";
import { useNow } from "@/hooks/useNow";
import { describeErr } from "@/lib/errors";
import { formatFriendlyIst } from "@/lib/format";
import { BriefMarkdown } from "./BriefMarkdown";
import { EvidenceLegend, EvidenceTag, type EvidenceLayer } from "./brief/EvidenceTag";
import { StatusBadge } from "./ui/StatusBadge";
import { IconSparkles } from "./ui/Icons";

type Layer = EvidenceLayer;
const LayerTag = EvidenceTag;

function pct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const v = p * 100;
  return `${Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v) : v.toFixed(1)}%`;
}

function duration(minutes: number | null | undefined): string | null {
  if (minutes == null) return null;
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))}m`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

const PROB_SOURCE_LABEL: Record<string, string> = {
  spot: "Live spot",
  settled: "Settled",
  primary_curve: "Primary curve",
};

const QUALITY_STYLE: Record<string, string> = {
  high: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
  medium: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
  low: "border-amber-400/40 bg-amber-400/10 text-amber-300",
};

/**
 * AI Market Brief card. Every block above "Interpretation" is rendered from the
 * deterministic `signals` object returned by /api/brief; only the narrative
 * below comes from the LLM (or the template when no OpenAI key is set).
 */
export function AiBrief({
  market,
  auto = false,
}: {
  market: Market;
  auto?: boolean;
}) {
  const [mode, setMode] = useState<BriefMode>("desk");
  const [nonce, setNonce] = useState(0);
  const [enabled, setEnabled] = useState(auto);
  const marketId = market.marketId;

  // Shared data layer: cached per marketId:mode:nonce, deduped in flight.
  const q = useBrief(marketId, mode, nonce, enabled);
  const busy = enabled && q.isFetching;
  const brief = q.data ?? null;
  const rateLimited = q.error instanceof BriefRateLimitError ? q.error : null;
  const error = q.error && !rateLimited ? describeErr(q.error) : null;
  const now = useNow(rateLimited ? 1000 : 60_000);
  const waitSec = rateLimited ? Math.max(0, Math.ceil((rateLimited.retryAt - now) / 1000)) : 0;

  const regenerate = () => {
    if (!enabled) setEnabled(true);
    else setNonce((n) => n + 1);
  };

  return (
    <AiBriefView
      id="brief"
      brief={brief}
      mode={mode}
      busy={busy}
      onModeChange={(m) => {
        if (m === mode) regenerate();
        else {
          setMode(m);
          setEnabled(true);
        }
      }}
      headerAction={
        <button type="button" onClick={regenerate} disabled={busy || waitSec > 0} className="btn btn-secondary btn-sm">
          {busy ? "Reading…" : brief ? "Regenerate" : "Generate"}
        </button>
      }
      notices={
        <>
          {error && (
            <div className="mb-3 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}
          {rateLimited && (
            <div
              role="status"
              className="mb-3 flex items-center justify-between gap-3 rounded-md border border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 py-2"
            >
              <p className="text-[12px] text-zinc-300">
                {waitSec > 0 ? (
                  <>
                    Brief limit reached ({BRIEF_RATE_LIMIT}/min). Ready again in{" "}
                    <span className="font-num font-semibold text-cyan-300">{waitSec}s</span>
                  </>
                ) : (
                  "Brief limit reset — ready to generate again."
                )}
              </p>
              {waitSec === 0 && (
                <button
                  type="button"
                  onClick={regenerate}
                  className="shrink-0 rounded-md bg-cyan-400/15 px-2 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-400/25"
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </>
      }
      showIdle={!error}
    />
  );
}

/**
 * Presentational brief card. The market page feeds it live `/api/brief`
 * payloads; the landing hero feeds it an illustrative payload computed by
 * the same signals engine from sample data.
 */
export function AiBriefView({
  id,
  brief,
  mode,
  busy = false,
  onModeChange,
  headerAction,
  notices,
  showIdle = true,
}: {
  id?: string;
  brief: BriefPayload | null;
  mode: BriefMode;
  busy?: boolean;
  onModeChange?: (m: BriefMode) => void;
  headerAction?: ReactNode;
  notices?: ReactNode;
  showIdle?: boolean;
}) {
  const s = brief?.signals ?? null;
  return (
    <section
      id={id}
      className="card relative scroll-mt-20 overflow-hidden border-violet-500/25"
      aria-label="AI market brief"
      aria-busy={busy}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: "var(--grad-ai)" }} />
      {/* Header */}
      <div className="flex min-h-[48px] items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <IconSparkles className="h-4 w-4 shrink-0 text-violet-300" />
          <h2 className="truncate text-[14px] font-semibold text-ink">AI Market Brief</h2>
          {brief && (
            <StatusBadge tone={brief.source === "openai" ? "ai" : "neutral"} size="xs" title="Interpretation source">
              {brief.source === "openai" ? "LLM" : "Template"}
            </StatusBadge>
          )}
        </div>
        {headerAction ? <div className="flex items-center gap-2">{headerAction}</div> : null}
      </div>

      {/* Mode tabs */}
      <div className="border-b border-line px-3 py-2.5">
        <div role="tablist" aria-label="Brief mode" className="segmented scrollbar-none flex w-full overflow-x-auto">
          {BRIEF_MODES.map((m) => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                role="tab"
                type="button"
                aria-selected={active}
                title={m.hint}
                onClick={() => onModeChange?.(m.id)}
                className="flex-1 whitespace-nowrap"
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4">
        {notices}
        {!s && busy && <LoadingState />}
        {!s && !busy && showIdle && (
          <p className="type-body text-zinc-500">
            Deterministic signals from the live price and tape, then an interpretation. Pick a mode
            and generate.
          </p>
        )}
        {s && brief && (
          <div className={`transition-opacity ${busy ? "opacity-50" : "animate-fade-in"}`}>
            <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3">
              <span>
                Data as of <span className="font-num text-ink-2">{formatFriendlyIst(s.computedAt)}</span>
              </span>
              {brief.cached ? <span>· cached</span> : null}
              <EvidenceLegend />
            </p>
            {s.dataQuality.grade === "low" && (
              <div className="mb-3 rounded-md border border-amber-400/25 bg-amber-400/[0.06] px-2.5 py-2">
                <p className="text-[11px] font-semibold text-amber-300">
                  Low data quality — read this as description, not signal
                </p>
                <p className="type-meta mt-0.5 text-amber-200/70">
                  {s.dataQuality.reasons.join(" · ")}
                </p>
              </div>
            )}

            <div className="mb-1.5 flex items-center gap-2">
              <LayerTag layer={s.probability.yes == null ? "unknown" : "observed"} />
              <span className="text-[11px] text-ink-3">Market snapshot</span>
            </div>
            <ProbabilityBlock s={s} />
            <div className="mt-3 divide-y divide-line rounded-xl border border-line bg-inset">
              <FlowRow s={s} />
              <Row label="Signal" layer={s.flow.yesFlowShare == null ? "unknown" : "derived"}>
                <p className="type-body">{s.headline}</p>
              </Row>
              <PriceRow s={s} />
              <Row label="Risk" layer="derived">
                {s.riskFlags.length ? (
                  <ul className="space-y-1">
                    {s.riskFlags.map((f) => (
                      <li key={f.id} className="flex items-start gap-2 text-[12px] leading-5 text-zinc-300">
                        <span
                          aria-hidden
                          className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                            f.severity === "warn" ? "bg-amber-400" : "bg-zinc-500"
                          }`}
                        />
                        {f.label}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="type-body text-zinc-400">No deterministic risk flags raised.</p>
                )}
              </Row>
              <Row label="Execution" layer="observed">
                <ul className="space-y-1">
                  {s.execution.lines.map((l) => (
                    <li key={l} className="text-[12px] leading-5 text-zinc-300">
                      {l}
                    </li>
                  ))}
                </ul>
              </Row>
              <Row label="Data quality" layer="derived">
                <div className="flex flex-wrap items-center gap-2">
                  <QualityBadge grade={s.dataQuality.grade} />
                  <span className="type-meta">{s.dataQuality.reasons.join(" · ")}</span>
                </div>
              </Row>
              <Row label="Not in data" layer="unknown">
                <ul className="space-y-1 text-[12px] leading-5 text-ink-2">
                  {s.probability.yes == null && <li>Live price for this market</li>}
                  {s.tape.count === 0 && <li>Recent trade flow (no prints in the window)</li>}
                  <li>Order-book depth, off-chain news and who the traders are</li>
                </ul>
              </Row>
            </div>

            {/* Interpretation */}
            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <EvidenceTag layer="interpretation" />
                <h3 className="text-[13px] font-semibold text-ink">
                  {brief.source === "openai" ? "AI interpretation" : "Interpretation"}
                </h3>
                <span className="rounded border border-violet-500/40 px-1.5 py-0.5 text-[10px] text-violet-200">
                  {brief.source === "openai" ? "LLM · potential interpretation" : "Template · AI unavailable"}
                </span>
                <span className="type-meta font-num">
                  {formatFriendlyIst(brief.generatedAt)}
                  {brief.cached ? " · cached" : ""}
                </span>
              </div>
              <div className="rounded-xl border border-violet-500/20 bg-inset p-3">
                <BriefMarkdown source={brief.narrative} />
              </div>
              <p className="type-meta mt-2">
                Blocks above are computed deterministically from the live price and tape. The
                interpretation is descriptive — not a recommendation to buy or sell.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Row({ label, layer, children }: { label: string; layer?: Layer; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-3 px-3 py-2.5">
      <div className="flex flex-col gap-1 pt-0.5">
        <span className="type-col">{label}</span>
        {layer ? <LayerTag layer={layer} /> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function QualityBadge({ grade }: { grade: MarketSignals["dataQuality"]["grade"] }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${QUALITY_STYLE[grade]}`}
      title="Data quality"
    >
      {grade}
    </span>
  );
}

function ProbabilityBlock({ s }: { s: MarketSignals }) {
  const { yes, no, source } = s.probability;
  const resolvesIn = duration(s.resolution.minutesToResolution);
  const lastPrint = duration(s.tape.lastPrintAgeMinutes);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <ProbCell side="YES" value={yes} won={s.outcome === "yes"} />
        <ProbCell side="NO" value={no} won={s.outcome === "no"} />
      </div>
      {yes != null && (
        <div className="mt-2 flex h-1 overflow-hidden rounded-full bg-elevated" aria-hidden>
          <div className="bg-emerald-400/70" style={{ width: `${yes * 100}%` }} />
          <div className="bg-rose-400/60" style={{ width: `${(no ?? 1 - yes) * 100}%` }} />
        </div>
      )}
      <p className="type-meta mt-1.5 font-num">
        {source ? PROB_SOURCE_LABEL[source] : "No live price"}
        {s.phase && !s.resolved ? ` · ${s.phase} phase` : ""}
        {resolvesIn ? ` · resolves in ${resolvesIn}` : s.resolution.passed ? " · resolution time passed" : ""}
        {lastPrint ? ` · last print ${lastPrint} ago` : ""}
      </p>
    </div>
  );
}

function ProbCell({ side, value, won }: { side: "YES" | "NO"; value: number | null; won: boolean }) {
  const yes = side === "YES";
  return (
    <div
      className={`rounded-md border px-3 py-2.5 ${
        yes ? "border-emerald-500/20 bg-emerald-500/[0.05]" : "border-rose-500/20 bg-rose-500/[0.05]"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-semibold tracking-wider ${yes ? "text-emerald-400/80" : "text-rose-400/80"}`}>
          {side}
        </span>
        {won && (
          <span className={`text-[10px] font-semibold ${yes ? "text-emerald-300" : "text-rose-300"}`}>
            Resolved
          </span>
        )}
      </div>
      <div
        className={`font-num mt-0.5 text-[28px] font-semibold leading-none tracking-tight ${
          value == null ? "text-zinc-600" : yes ? "text-emerald-300" : "text-rose-300"
        }`}
      >
        {pct(value)}
      </div>
    </div>
  );
}

function FlowRow({ s }: { s: MarketSignals }) {
  const { yesFlowShare, basis } = s.flow;
  const n = s.tape.count;
  if (yesFlowShare == null) {
    return (
      <Row label="Flow" layer="unknown">
        <p className="type-body text-zinc-400">
          {n === 0 ? "No recent prints — flow unavailable." : `${n} print(s) without a readable side.`}
        </p>
      </Row>
    );
  }
  return (
    <Row label="Flow" layer="derived">
      <div className="flex flex-wrap items-baseline gap-x-2 font-num text-[13px]">
        <span className="font-semibold text-emerald-300">YES {pct(yesFlowShare)}</span>
        <span className="text-zinc-600">·</span>
        <span className="font-semibold text-rose-300">NO {pct(1 - yesFlowShare)}</span>
        <span className="type-meta">
          {n} recent print{n === 1 ? "" : "s"} · {basis === "shares" ? "share-weighted" : "print-weighted"}
        </span>
      </div>
      <div className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-elevated" aria-hidden>
        <div className="bg-emerald-400/70" style={{ width: `${yesFlowShare * 100}%` }} />
        <div className="bg-rose-400/60" style={{ width: `${(1 - yesFlowShare) * 100}%` }} />
      </div>
      <p className="type-meta mt-1 font-num">
        {s.tape.yesPrints} YES / {s.tape.noPrints} NO prints
        {s.volume.recentShares != null ? ` · ${s.volume.recentShares.toLocaleString()} shares` : ""}
        {s.volume.recentUsdc != null ? ` · ${s.volume.recentUsdc.toLocaleString()} USDC` : ""}
      </p>
    </Row>
  );
}

function PriceRow({ s }: { s: MarketSignals }) {
  const d = s.divergence;
  const dirLabel =
    d.direction === "aligned"
      ? "aligned"
      : d.direction === "flow_above_price"
        ? "flow leans more YES than price"
        : d.direction === "flow_below_price"
          ? "flow leans more NO than price"
          : null;
  return (
    <Row label="Price" layer={d.marketYes == null ? "unknown" : "observed"}>
      <div className="flex flex-wrap items-baseline gap-x-2 font-num text-[13px] text-zinc-300">
        <span>
          Market <span className="font-semibold text-zinc-100">{pct(d.marketYes)}</span> YES
        </span>
        <span className="text-zinc-600">vs</span>
        <span>
          Recent flow <span className="font-semibold text-zinc-100">{pct(d.flowYes)}</span> YES
        </span>
        {d.gapPts != null && (
          <span className="rounded bg-cyan-400/10 px-1.5 py-0.5 text-[11px] text-cyan-300">
            {d.gapPts > 0 ? "+" : ""}
            {d.gapPts} pts
          </span>
        )}
      </div>
      <p className="type-meta mt-1">{dirLabel ?? d.reason}</p>
    </Row>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="skeleton h-[62px]" />
        <div className="skeleton h-[62px]" />
      </div>
      <div className="skeleton h-3 w-full" />
      <div className="skeleton h-3 w-5/6" />
      <div className="skeleton h-3 w-4/6" />
      <p className="type-lede">Computing signals from the live tape…</p>
    </div>
  );
}

/** Evidence row, shared with the landing AI section so both read identically. */
export { Row as BriefRow };
