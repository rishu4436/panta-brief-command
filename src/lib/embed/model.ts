/**
 * Embed view model (pure): what the widget may say, derived from persisted
 * room data, the arena finalization record and a bounded market snapshot.
 *
 * Verified resolution is shown ONLY when (a) the arena finalized the market
 * as scored (Panta record + on-chain account agreed, persisted with
 * provenance), or (b) the snapshot read both sources and they agree. A
 * one-sided "resolved" is shown as awaiting verification, without the side.
 */

import { consensusFrom, type ForecastAggregate } from "@/lib/forecasts/domain";
import { LIFECYCLE_LABEL, marketLifecycle, type Lifecycle } from "@/lib/panta/catalog";
import type { Market } from "@/lib/panta/domain";
import { deskPriceDisplay, formatUsdcPerShare, marketLabel } from "@/lib/format";
import type { FinalizationRecord } from "@/lib/arena/types";

export type SnapshotLike = {
  status: "fresh" | "stale" | "catalog" | "unavailable";
  market: Market | null;
  ageMs: number | null;
  sourcesAgreeResolved: { outcome: "yes" | "no"; slot: number } | null;
  /** false when only the on-chain account answered (Panta's record slow or failing). */
  detailOk?: boolean;
};

export type EmbedPrice =
  | { mode: "probability"; yesPct: string }
  | { mode: "secondary"; yes: string; no: string }
  | { mode: "none"; why: string };

export type EmbedResolution =
  | { kind: "verified"; outcome: "yes" | "no"; via: "arena" | "sources"; slot: number | null }
  | { kind: "blocked" }
  | { kind: "awaiting_verification" }
  | null;

export type EmbedModel = {
  slug: string;
  title: string;
  roomUrl: string;
  /** Widget links: the canonical room URL + `?ref=embed` (counted as an embed click-through when the room page loads). */
  ctaUrl: string;
  homeUrl: string;
  question: string | null;
  community: { participants: number; meanBps: number | null; buckets: number[] };
  market: { status: SnapshotLike["status"]; freshness: string; lifecycle: Lifecycle | null; lifecycleLabel: string; price: EmbedPrice };
  resolution: EmbedResolution;
  forecastingOpen: boolean;
};

const pct = (p: number) => {
  const v = Math.round(p * 1000) / 10;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;
};

export function freshnessLabel(s: SnapshotLike): string {
  if ((s.status === "fresh" || s.status === "stale") && s.detailOk === false) {
    const age = Math.round((s.ageMs ?? 0) / 1000);
    return `On-chain market data checked ${age < 5 ? "just now" : age < 120 ? `${age} s ago` : `${Math.round(age / 60)} min ago`} · Panta's market record didn't load in time`;
  }
  if (s.status === "fresh") return s.ageMs !== null && s.ageMs >= 5_000 ? `Panta data checked ${Math.round(s.ageMs / 1000)} s ago` : "Panta data just checked";
  if (s.status === "stale") return `Panta data from ${Math.max(1, Math.round((s.ageMs ?? 0) / 60_000))} min ago · refreshing`;
  if (s.status === "catalog") return "From Panta's market list · may be a few minutes old";
  return "Panta market data is unavailable right now · community data is current";
}

export function buildEmbedModel(input: {
  room: { slug: string; title: string };
  origin: string;
  aggregate: ForecastAggregate;
  finalization: FinalizationRecord | null;
  snapshot: SnapshotLike;
  nowMs: number;
}): EmbedModel {
  const { room, origin, aggregate, finalization, snapshot, nowMs } = input;
  const c = consensusFrom(aggregate);
  const m = snapshot.market;
  const lifecycle = m ? marketLifecycle(m, Math.floor(nowMs / 1000)) : null;

  let resolution: EmbedResolution = null;
  if (finalization?.status === "scored" && finalization.outcome) {
    resolution = { kind: "verified", outcome: finalization.outcome, via: "arena", slot: finalization.provenance.chain.slot };
  } else if (finalization?.status === "blocked") {
    resolution = { kind: "blocked" };
  } else if (snapshot.sourcesAgreeResolved) {
    resolution = { kind: "verified", outcome: snapshot.sourcesAgreeResolved.outcome, via: "sources", slot: snapshot.sourcesAgreeResolved.slot };
  } else if (lifecycle === "resolved") {
    resolution = { kind: "awaiting_verification" };
  }

  let price: EmbedPrice = { mode: "none", why: "Panta price unavailable" };
  if (!m) price = { mode: "none", why: "Panta price unavailable" };
  else if (lifecycle === "resolved" || lifecycle === "cancelled" || resolution) price = { mode: "none", why: lifecycle === "cancelled" ? "Market cancelled" : "Market resolved" };
  else {
    const d = deskPriceDisplay(m);
    if (d.mode === "probability" && Number.isFinite(Number(d.yes))) price = { mode: "probability", yesPct: pct(Number(d.yes)) };
    else if (d.mode === "secondary") price = { mode: "secondary", yes: formatUsdcPerShare(d.yes), no: formatUsdcPerShare(d.no) };
  }

  const slug = encodeURIComponent(room.slug);
  return {
    slug: room.slug,
    title: room.title,
    roomUrl: `${origin}/rooms/${slug}`,
    ctaUrl: `${origin}/rooms/${slug}?ref=embed`,
    homeUrl: origin,
    question: m && (m.title || "").trim() ? marketLabel(m, { max: 160 }) : null,
    community: { participants: c.participants, meanBps: c.kind === "consensus" ? c.meanBps : null, buckets: c.buckets },
    market: {
      status: snapshot.status,
      freshness: freshnessLabel(snapshot),
      lifecycle,
      lifecycleLabel: lifecycle ? LIFECYCLE_LABEL[lifecycle] : "Market status unavailable",
      price,
    },
    resolution,
    forecastingOpen: lifecycle === "open" && !resolution,
  };
}
