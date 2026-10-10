"use client";

/**
 * AI Debate Arena section of a Prediction Room (#debate). Shows the room's
 * stored debate: the strongest sourced case for YES and for NO, the Evidence
 * Referee's audit, every citation with its provenance, and claim challenges.
 * It is a research aid: no probabilities, no winner, no advice, and it never
 * decides how the market resolves. Page views never generate anything.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useChallengeClaim, useDebate, useGenerateDebate, newIdempotencyKey, type DebateViewResponse } from "@/lib/debate/client";
import {
  CHALLENGE_VERDICT_LABEL,
  CLAIM_KIND_LABEL,
  PROVENANCE_LABEL,
  claimAnchor,
  type DebateChallenge,
  type DebateClaim,
  type DebateEvidence,
  type Side,
} from "@/lib/debate/domain";
import { formatFriendlyIst, shortAddr } from "@/lib/format";
import { RoomApiError } from "@/lib/rooms/client";
import type { Room } from "@/lib/rooms/domain";
import { Panel } from "../Panel";
import { ErrorState, Skeleton } from "../ui/States";
import { StatusBadge, type StatusTone } from "../ui/StatusBadge";

type Bundle = NonNullable<DebateViewResponse["debate"]>;

const SIDE_LABEL: Record<Side, string> = { yes: "Case for YES", no: "Case for NO" };
const SUFFICIENCY_LABEL = { supported: "Evidence: supported", limited: "Evidence: limited", insufficient: "Evidence: insufficient" } as const;
const SUFFICIENCY_TONE: Record<string, StatusTone> = { supported: "success", limited: "warning", insufficient: "error" };
const QUALITY_LABEL = { strong: "Evidence quality: strong", moderate: "Evidence quality: moderate", thin: "Evidence quality: thin" } as const;
const VERIFICATION_LABEL = { verified: "Read from Panta / chain", retrieved: "Retrieved by our server", user_submitted: "User-submitted" } as const;
const VERDICT_TONE: Record<string, StatusTone> = { claim_stands: "success", claim_weakened: "warning", claim_unsupported: "error", insufficient_evidence: "neutral" };
const FLAG_TEXT: Record<string, string> = {
  no_valid_evidence: "Cites no valid evidence",
  cited_unknown_evidence: "Cited a source that doesn't exist (removed)",
  fact_rests_on_user_source: "A fact resting only on a user-submitted source",
};

const noSubscribe = () => () => undefined;
function readDebateParam(): string | null {
  const v = new URLSearchParams(window.location.search).get("debate");
  return v && /^dbt_[a-f0-9]{8,32}$/.test(v) ? v : null;
}
/** ?debate=<id> (client only; the server render has none). */
function useDebateParam(): string | null {
  return useSyncExternalStore(noSubscribe, readDebateParam, () => null);
}

function copy(text: string, done: (s: string) => void) {
  navigator.clipboard?.writeText(text).then(
    () => done("Link copied"),
    () => done("Couldn't copy — select the address bar instead"),
  );
}

export function DebateArena({ room, sessionWallet, canonicalUrl }: { room: Room; sessionWallet: string | null; canonicalUrl: string }) {
  const debateParam = useDebateParam();
  const q = useDebate(room.slug, debateParam);
  const gen = useGenerateDebate(room.slug);
  const [genKey, setGenKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // Scroll to a claim anchor once its debate has rendered.
  useEffect(() => {
    if (!q.data?.debate) return;
    const h = window.location.hash.slice(1);
    if (h.startsWith("claim-")) document.getElementById(h)?.scrollIntoView({ block: "center" });
  }, [q.data?.debate]);

  const onGenerate = () => {
    const key = genKey ?? newIdempotencyKey();
    setGenKey(key);
    gen.mutate(key, { onSuccess: () => setGenKey(null) });
  };

  const data = q.data;
  const verified = Boolean(sessionWallet) || Boolean(data?.viewer.verified);
  const debate = data?.debate ?? null;

  let body: React.ReactNode;
  if (q.isPending) {
    body = (
      <div className="space-y-3" aria-busy="true" aria-label="Loading debate">
        <Skeleton className="h-5 w-2/3" />
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  } else if (q.isError) {
    const e = q.error;
    body =
      e instanceof RoomApiError && e.status === 404 ? (
        <p className="text-[13px] text-ink-3">This room isn&apos;t available, so its debate isn&apos;t either.</p>
      ) : (
        <ErrorState title="Couldn't load the debate" description={e instanceof Error ? e.message : undefined} onRetry={() => q.refetch()} />
      );
  } else if (data) {
    body = (
      <div className="space-y-4">
        <StateBanner data={data} genError={gen.error} generating={gen.isPending || data.generating} />
        {data.requestedDebateMissing ? (
          <p role="status" className="rounded-lg border border-line bg-inset/50 px-3 py-2 text-[12px] text-ink-3">
            The linked debate is no longer kept for this room (only the newest few are). Showing the latest one instead.
          </p>
        ) : null}
        <GenerateBar data={data} verified={verified} busy={gen.isPending} onGenerate={onGenerate} />
        {debate ? (
          <DebateBody
            bundle={debate}
            data={data}
            slug={room.slug}
            verified={verified}
            onShare={(hash, withId) => copy(`${canonicalUrl}${withId ? `?debate=${debate.debate.debateId}` : ""}#${hash}`, setToast)}
          />
        ) : null}
        {data.history.length > 1 ? <History data={data} /> : null}
      </div>
    );
  }

  return (
    <Panel
      id="debate"
      title={<span className="whitespace-nowrap">AI Debate Arena</span>}
      subtitle="Sourced arguments for both sides · research aid, not advice"
      className="min-w-0"
      action={debate ? <StatusBadge tone="ai" size="xs">AI-generated</StatusBadge> : undefined}
    >
      {body}
      <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-3">
        The arena cites only material our server read itself (Panta&apos;s record, the on-chain market account, market-activity signals and the
        market&apos;s declared sources). It gives no probability, picks no winner and doesn&apos;t decide resolution — the market&apos;s resolution
        rule does.
      </p>
      <div aria-live="polite" className="sr-only">
        {toast}
      </div>
      {toast ? <p className="mt-2 text-[12px] text-cyan-200">{toast}</p> : null}
    </Panel>
  );
}

// ------------------------------------------------------------------ state + generation

function StateBanner({ data, genError, generating }: { data: DebateViewResponse; genError: unknown; generating: boolean }) {
  const d = data.debate;
  const items: { tone: StatusTone; title: string; text: string }[] = [];
  if (generating) items.push({ tone: "info", title: "Generating", text: "Reading sources and building both cases. This takes up to a minute; nothing is shown until it passes our checks." });
  if (genError instanceof RoomApiError) {
    const titles: Record<string, string> = {
      AI_UNAVAILABLE: "AI unavailable",
      GENERATION_FAILED: "Generation failed",
      GENERATION_IN_PROGRESS: "Already generating",
      MARKET_RESOLVED: "Market resolved",
      GENERATION_CLOSED: "Generation closed",
      MARKET_UNAVAILABLE: "Market status unavailable",
      RATE_LIMITED: "Slow down",
      WALLET_NOT_VERIFIED: "Verify your wallet",
    };
    items.push({ tone: genError.code === "GENERATION_IN_PROGRESS" ? "info" : "error", title: titles[genError.code] ?? "Couldn't generate", text: genError.message });
  }
  if (!data.ai.available && !d) {
    items.push({ tone: "neutral", title: "AI unavailable", text: "AI analysis isn't configured on this server (no model API key), so no debate can be generated. Nothing here is simulated." });
  }
  if (data.market.resolved) {
    items.push({ tone: "neutral", title: "Market resolved", text: d ? "These arguments were generated before resolution and are kept as a historical record. No new debates are generated." : "This market resolved before any debate was generated. No new debates are generated after resolution." });
  }
  if (d && d.freshness === "stale") items.push({ tone: "warning", title: "Stale — not current", text: d.staleReasons.join(" ") });
  if (d && d.debate.status === "insufficient_evidence") items.push({ tone: "warning", title: "Insufficient evidence", text: "The available sources don't support a substantive case for either side. The arguments below say what is missing." });
  if (!items.length) return null;
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.title} role="status" className="flex items-start gap-2 rounded-lg border border-line bg-inset/50 px-3 py-2">
          <StatusBadge tone={i.tone} size="xs">{i.title}</StatusBadge>
          <span className="min-w-0 text-[12px] leading-relaxed text-ink-2">{i.text}</span>
        </li>
      ))}
    </ul>
  );
}

function GenerateBar({ data, verified, busy, onGenerate }: { data: DebateViewResponse; verified: boolean; busy: boolean; onGenerate: () => void }) {
  const d = data.debate;
  const needsNew = !d || (d.isLatest && d.freshness === "stale");
  if (!needsNew || data.market.resolved) return null;
  if (!data.generation.allowed) {
    if (!data.ai.available) return null; // the banner already explains
    return <p className="text-[12px] text-ink-3">{data.generation.reason}</p>;
  }
  if (!d && !verified) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-inset/40 p-4 text-center">
        <p className="text-[14px] font-semibold text-ink">No debate yet</p>
        <p className="mt-1 text-[12px] text-ink-3">
          A verified wallet can generate one (free, rate limited). <a href="#forecasts" className="text-cyan-300 underline-offset-2 hover:underline">Verify in Forecasts</a>.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line bg-inset/40 p-3">
      <p className="min-w-0 flex-1 text-[12px] text-ink-2">{d ? "This debate is out of date. Generate a fresh one from current sources." : "No debate yet for this room."}</p>
      {verified ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={onGenerate} disabled={busy || data.generating}>
          {busy || data.generating ? "Generating…" : d ? "Refresh debate" : "Generate debate"}
        </button>
      ) : (
        <a href="#forecasts" className="text-[12px] text-cyan-300 underline-offset-2 hover:underline">
          Verify your wallet to refresh
        </a>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ debate body

function DebateBody({ bundle, data, slug, verified, onShare }: { bundle: Bundle; data: DebateViewResponse; slug: string; verified: boolean; onShare: (hash: string, withId: boolean) => void }) {
  const d = bundle.debate;
  const evIndex = useMemo(() => new Map(bundle.evidence.map((e, i) => [e.evidenceId, i + 1])), [bundle.evidence]);
  const evById = useMemo(() => new Map(bundle.evidence.map((e) => [e.evidenceId, e])), [bundle.evidence]);
  const claimById = useMemo(() => new Map(bundle.claims.map((c) => [c.claimId, c])), [bundle.claims]);
  const canChallenge = data.ai.available && bundle.isLatest && !data.market.resolved;
  const freshTone: StatusTone = bundle.freshness === "current" ? "success" : bundle.freshness === "historical" ? "neutral" : "warning";
  const freshLabel = bundle.freshness === "current" ? "Current" : bundle.freshness === "historical" ? "Pre-resolution" : "Stale";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-gradient-to-br from-violet-500/[0.06] via-transparent to-cyan-400/[0.04] p-4">
        <p className="eyebrow">Question</p>
        <h3 className="mt-1 break-words text-[16px] font-semibold leading-snug text-ink">{d.marketQuestion}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
          <StatusBadge tone={freshTone} size="xs">{freshLabel}</StatusBadge>
          <span>Generated {formatFriendlyIst(d.createdAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{bundle.freshness === "current" ? `Fresh until ${formatFriendlyIst(d.expiresAt)}` : `Was fresh until ${formatFriendlyIst(d.expiresAt)}`}</span>
          <span aria-hidden="true">·</span>
          <span>Market was {d.lifecycleAtGeneration}</span>
          <span aria-hidden="true">·</span>
          <span>
            {d.model.provider}/{d.model.model} · {d.generationVersion}
          </span>
          <button type="button" className="ml-auto text-cyan-300 underline-offset-2 hover:underline" onClick={() => onShare("debate", true)}>
            Copy link to this debate
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {(["yes", "no"] as const).map((side) => (
          <SidePanel
            key={side}
            side={side}
            bundle={bundle}
            evIndex={evIndex}
            evById={evById}
            challenges={data.challenges}
            canChallenge={canChallenge}
            verified={verified}
            slug={slug}
            onShare={onShare}
          />
        ))}
      </div>

      <RefereePanel bundle={bundle} evIndex={evIndex} claimById={claimById} />

      <details className="rounded-xl border border-line bg-inset/30 p-3">
        <summary className="cursor-pointer text-[13px] font-semibold text-ink-2">Sources ({bundle.evidence.length}) and limitations</summary>
        <ol className="mt-3 space-y-2">
          {bundle.evidence.map((e) => (
            <li key={e.evidenceId}>
              <EvidenceCard e={e} n={evIndex.get(e.evidenceId) ?? 0} />
            </li>
          ))}
        </ol>
        {d.limitations.length || d.sourceFailures.length ? (
          <div className="mt-3 space-y-1 text-[12px] text-ink-3">
            <p className="font-semibold text-ink-2">Limitations</p>
            <ul className="list-disc space-y-1 pl-5">
              {d.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
              {d.sourceFailures.map((f) => (
                <li key={f.url}>
                  Couldn&apos;t read <span className="break-all font-addr">{f.url}</span> ({f.reason}).
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </details>
    </div>
  );
}

function SidePanel(props: {
  side: Side;
  bundle: Bundle;
  evIndex: Map<string, number>;
  evById: Map<string, DebateEvidence>;
  challenges: DebateChallenge[];
  canChallenge: boolean;
  verified: boolean;
  slug: string;
  onShare: (hash: string, withId: boolean) => void;
}) {
  const { side, bundle } = props;
  const c = bundle.debate[side];
  const claims = c.claimIds.map((id) => bundle.claims.find((x) => x.claimId === id)).filter((x): x is DebateClaim => Boolean(x));
  const accent = side === "yes" ? "border-emerald-400/25" : "border-rose-400/25";
  return (
    <section aria-labelledby={`debate-${side}`} className={`min-w-0 rounded-xl border ${accent} bg-elevated/40 p-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`debate-${side}`} className="text-[14px] font-semibold text-ink">
          {SIDE_LABEL[side]}
        </h3>
        <StatusBadge tone={SUFFICIENCY_TONE[c.sufficiency]} size="xs">{SUFFICIENCY_LABEL[c.sufficiency]}</StatusBadge>
      </div>
      {c.thesis ? <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{c.thesis}</p> : <p className="mt-2 text-[13px] text-ink-3">No thesis — the evidence doesn&apos;t support a case for this side.</p>}
      {c.sufficiencyNote ? <p className="mt-1 text-[12px] text-ink-3">{c.sufficiencyNote}</p> : null}
      <ol className="mt-3 space-y-2">
        {claims.map((cl, i) => (
          <li key={cl.claimId}>
            <ClaimCard {...props} claim={cl} n={i + 1} />
          </li>
        ))}
      </ol>
      {claims.length === 0 ? <p className="mt-2 text-[12px] text-ink-3">No claims.</p> : null}
      <ListBlock title="Assumptions" items={c.assumptions} />
      <ListBlock title="What would weaken this case" items={c.invalidators} />
    </section>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-ink-2">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function ClaimCard({
  claim,
  n,
  side,
  evIndex,
  evById,
  challenges,
  canChallenge,
  verified,
  slug,
  bundle,
  onShare,
}: {
  claim: DebateClaim;
  n: number;
  side: Side;
  evIndex: Map<string, number>;
  evById: Map<string, DebateEvidence>;
  challenges: DebateChallenge[];
  canChallenge: boolean;
  verified: boolean;
  slug: string;
  bundle: Bundle;
  onShare: (hash: string, withId: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const mine = challenges.filter((c) => c.claimId === claim.claimId);
  const anchor = claimAnchor(claim.claimId);
  return (
    <article id={anchor} className="scroll-mt-24 rounded-lg border border-line bg-surface/60 p-3 target:ring-1 target:ring-cyan-400/60">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-num text-[11px] text-ink-3">
          {side.toUpperCase()}-{n}
        </span>
        <StatusBadge tone="neutral" size="xs">{CLAIM_KIND_LABEL[claim.kind]}</StatusBadge>
        <StatusBadge tone={claim.uncertainty === "low" ? "success" : claim.uncertainty === "medium" ? "warning" : "error"} size="xs">
          Uncertainty: {claim.uncertainty}
        </StatusBadge>
        {claim.status !== "supported" ? <StatusBadge tone="error" size="xs">{claim.status === "unsupported" ? "Unsupported" : "Flagged"}</StatusBadge> : null}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{claim.claimText}</p>
      {claim.rationale ? <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{claim.rationale}</p> : null}
      {claim.flags.length ? (
        <ul className="mt-1 text-[11px] text-rose-200/90">
          {claim.flags.map((f) => (
            <li key={f}>⚠ {FLAG_TEXT[f] ?? f}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {claim.evidenceRefs.map((r) => {
          const e = evById.get(r);
          return e ? <CitationChip key={r} e={e} n={evIndex.get(r) ?? 0} /> : null;
        })}
        {claim.evidenceRefs.length === 0 ? <span className="text-[11px] text-ink-3">No citations</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
        <button type="button" className="text-cyan-300 underline-offset-2 hover:underline" onClick={() => onShare(anchor, true)}>
          Copy claim link
        </button>
        {canChallenge ? (
          verified ? (
            <button type="button" className="text-cyan-300 underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? "Cancel challenge" : "Challenge this claim"}
            </button>
          ) : (
            <a href="#forecasts" className="text-ink-3 underline-offset-2 hover:underline">
              Verify your wallet to challenge
            </a>
          )
        ) : null}
        {mine.length ? <span className="text-ink-3">{mine.length} challenge{mine.length === 1 ? "" : "s"}</span> : null}
      </div>
      {open ? <ChallengeForm slug={slug} debateId={bundle.debate.debateId} claimId={claim.claimId} onDone={() => setOpen(false)} /> : null}
      {mine.length ? (
        <ol className="mt-2 space-y-2 border-l border-line pl-3">
          {mine.map((c) => (
            <li key={c.challengeId}>
              <ChallengeItem c={c} evIndex={evIndex} evById={evById} />
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}

function CitationChip({ e, n }: { e: DebateEvidence; n: number }) {
  return (
    <details className="group max-w-full">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-line bg-elevated px-1.5 py-0.5 text-[11px] text-ink-2 hover:border-cyan-400/40">
        <span className="font-num">[{n}]</span>
        <span className="max-w-[12rem] truncate">{e.sourceTitle}</span>
      </summary>
      <div className="mt-1.5">
        <EvidenceCard e={e} n={n} />
      </div>
    </details>
  );
}

function EvidenceCard({ e, n }: { e: DebateEvidence; n: number }) {
  return (
    <div className="rounded-lg border border-line bg-inset/50 p-2.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-num text-ink-3">[{n}]</span>
        <span className="font-semibold text-ink">{e.sourceTitle}</span>
        <StatusBadge tone={e.verificationStatus === "user_submitted" ? "warning" : e.verificationStatus === "verified" ? "success" : "info"} size="xs">
          {VERIFICATION_LABEL[e.verificationStatus]}
        </StatusBadge>
      </div>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] text-ink-3">
        <dt>Publisher</dt>
        <dd className="text-ink-2">{e.publisher}</dd>
        <dt>Type</dt>
        <dd className="text-ink-2">{PROVENANCE_LABEL[e.provenance]}</dd>
        <dt>Published</dt>
        <dd className="text-ink-2">{e.publishedAt ? formatFriendlyIst(e.publishedAt) : "Unknown"}</dd>
        <dt>Retrieved</dt>
        <dd className="text-ink-2">{formatFriendlyIst(e.retrievedAt)}</dd>
      </dl>
      <p className="mt-1.5 line-clamp-6 whitespace-pre-line break-words text-[11px] leading-relaxed text-ink-2">{e.excerpt}</p>
      {e.note ? <p className="mt-1 text-[11px] text-ink-3">{e.note}</p> : null}
      {e.sourceUrl ? (
        <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer nofollow ugc" className="mt-1 inline-block break-all text-[11px] text-cyan-300 underline-offset-2 hover:underline">
          {e.sourceUrl}
        </a>
      ) : (
        <p className="mt-1 text-[11px] text-ink-3">Read directly by our server (no public page).</p>
      )}
    </div>
  );
}

function ChallengeItem({ c, evIndex, evById }: { c: DebateChallenge; evIndex: Map<string, number>; evById: Map<string, DebateEvidence> }) {
  const user = new Map(c.responseEvidence.map((e) => [e.evidenceId, e]));
  return (
    <div className="text-[12px]">
      <p className="text-ink-3">
        <span className="font-addr" title={c.wallet}>
          {shortAddr(c.wallet, 4)}
        </span>{" "}
        · {formatFriendlyIst(c.createdAt)}
      </p>
      <p className="mt-0.5 whitespace-pre-line break-words text-ink-2">“{c.challengeText}”</p>
      <div className="mt-1 rounded-md border border-violet-500/25 bg-violet-500/[0.05] p-2">
        <div className="flex items-center gap-1.5">
          <StatusBadge tone="ai" size="xs">AI response</StatusBadge>
          <StatusBadge tone={VERDICT_TONE[c.response.verdict]} size="xs">{CHALLENGE_VERDICT_LABEL[c.response.verdict]}</StatusBadge>
        </div>
        <p className="mt-1 text-ink-2">{c.response.text}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {c.response.evidenceRefs.map((r) => {
            const e = evById.get(r) ?? user.get(r);
            return e ? <CitationChip key={r} e={e} n={evIndex.get(r) ?? 0} /> : null;
          })}
        </div>
      </div>
    </div>
  );
}

function ChallengeForm({ slug, debateId, claimId, onDone }: { slug: string; debateId: string; claimId: string; onDone: () => void }) {
  const m = useChallengeClaim(slug);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const trimmed = text.trim();
  const valid = trimmed.length >= 10 && trimmed.length <= 500 && (!url.trim() || /^https:\/\//i.test(url.trim()));
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!valid || m.isPending) return;
    const k = key ?? newIdempotencyKey();
    setKey(k);
    m.mutate(
      { debateId, claimId, text: trimmed, sourceUrl: url.trim() || null, idempotencyKey: k },
      {
        onSuccess: () => {
          setText("");
          setUrl("");
          setKey(null);
          onDone();
        },
      },
    );
  };
  const id = `challenge-${claimId}`;
  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-lg border border-line bg-inset/40 p-2.5">
      <label htmlFor={id} className="block text-[11px] font-semibold text-ink-2">
        Your challenge <span className="font-normal text-ink-3">(10–500 characters; plain text)</span>
      </label>
      <textarea
        id={id}
        className="field min-h-[72px] w-full resize-y text-[13px]"
        maxLength={500}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setKey(null);
        }}
        placeholder="What's wrong with this claim? Point to what the sources actually say."
      />
      <label htmlFor={`${id}-url`} className="block text-[11px] font-semibold text-ink-2">
        Supporting link <span className="font-normal text-ink-3">(optional, https; our server reads it and labels it user-submitted)</span>
      </label>
      <input
        id={`${id}-url`}
        className="field w-full text-[13px]"
        inputMode="url"
        maxLength={500}
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setKey(null);
        }}
        placeholder="https://"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="font-num text-[11px] text-ink-3">{trimmed.length}/500</span>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!valid || m.isPending}>
          {m.isPending ? "Checking the evidence…" : "Submit challenge"}
        </button>
      </div>
      {m.error ? (
        <p role="alert" className="text-[12px] text-rose-200">
          {m.error instanceof Error ? m.error.message : "Couldn't submit."}
        </p>
      ) : null}
    </form>
  );
}

// ------------------------------------------------------------------ referee + history

function RefClaimLink({ id, label }: { id: string; label: string }) {
  return (
    <a href={`#${claimAnchor(id)}`} className="font-num text-cyan-300 underline-offset-2 hover:underline">
      {label}
    </a>
  );
}

function Section({ title, children, show }: { title: string; children: React.ReactNode; show: boolean }) {
  if (!show) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{title}</p>
      <div className="mt-1 text-[12px] text-ink-2">{children}</div>
    </div>
  );
}

function RefereePanel({ bundle, evIndex, claimById }: { bundle: Bundle; evIndex: Map<string, number>; claimById: Map<string, DebateClaim> }) {
  const r = bundle.debate.referee;
  const label = (id: string) => {
    const c = claimById.get(id);
    if (!c) return id;
    const n = bundle.debate[c.side].claimIds.indexOf(id) + 1;
    return `${c.side.toUpperCase()}-${n}`;
  };
  const ClaimLink = ({ id }: { id: string }) => <RefClaimLink id={id} label={label(id)} />;
  return (
    <section aria-labelledby="debate-referee" className="rounded-xl border border-violet-500/25 bg-violet-500/[0.04] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="debate-referee" className="text-[14px] font-semibold text-ink">
          Evidence Referee
        </h3>
        <StatusBadge tone={r.evidenceQuality === "strong" ? "success" : r.evidenceQuality === "moderate" ? "warning" : "error"} size="xs">
          {QUALITY_LABEL[r.evidenceQuality]}
        </StatusBadge>
        <span className="text-[11px] text-ink-3">Audits both cases · declares no winner</span>
      </div>
      {r.overview ? <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{r.overview}</p> : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Section title="Unsupported claims" show={r.unsupportedClaims.length > 0}>
          <ul className="space-y-1">
            {r.unsupportedClaims.map((u) => (
              <li key={u.claimId}>
                <ClaimLink id={u.claimId} /> — {u.note}
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Contradictions" show={r.contradictions.length > 0}>
          <ul className="space-y-1">
            {r.contradictions.map((c, i) => (
              <li key={i}>
                {c.claimIds.map((id, j) => (
                  <span key={id}>
                    {j ? ", " : ""}
                    <ClaimLink id={id} />
                  </span>
                ))}{" "}
                — {c.note}
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Weak or outdated evidence" show={r.weakEvidence.length > 0}>
          <ul className="space-y-1">
            {r.weakEvidence.map((w) => (
              <li key={w.evidenceId}>
                <span className="font-num">[{evIndex.get(w.evidenceId) ?? "?"}]</span> — {w.note}
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Possible source bias" show={r.sourceBias.length > 0}>
          <ul className="space-y-1">
            {r.sourceBias.map((b, i) => (
              <li key={i}>
                {b.evidenceId ? <span className="font-num">[{evIndex.get(b.evidenceId) ?? "?"}] </span> : null}
                {b.note}
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Missing information" show={r.missingInformation.length > 0}>
          <ul className="list-disc space-y-0.5 pl-5">
            {r.missingInformation.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Section>
        <Section title="What would change this analysis" show={r.wouldChangeAnalysis.length > 0}>
          <ul className="list-disc space-y-0.5 pl-5">
            {r.wouldChangeAnalysis.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Section>
        <Section title="Where both sides agree" show={r.agreement.length > 0}>
          <ul className="list-disc space-y-0.5 pl-5">
            {r.agreement.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Section>
      </div>
    </section>
  );
}

function History({ data }: { data: DebateViewResponse }) {
  const current = data.debate?.debate.debateId;
  return (
    <details className="rounded-xl border border-line bg-inset/30 p-3">
      <summary className="cursor-pointer text-[13px] font-semibold text-ink-2">Earlier debates ({data.history.length})</summary>
      <ul className="mt-2 space-y-1 text-[12px]">
        {data.history.map((h, i) => (
          <li key={h.debateId} className="flex flex-wrap items-center gap-2">
            {h.debateId === current ? (
              <span className="font-semibold text-ink">{formatFriendlyIst(h.createdAt)} (shown)</span>
            ) : (
              <a href={i === 0 ? "?#debate" : `?debate=${h.debateId}#debate`} className="text-cyan-300 underline-offset-2 hover:underline">
                {formatFriendlyIst(h.createdAt)}
              </a>
            )}
            {i === 0 ? <StatusBadge tone="neutral" size="xs">Latest</StatusBadge> : null}
            {h.status === "insufficient_evidence" ? <StatusBadge tone="warning" size="xs">Insufficient evidence</StatusBadge> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
