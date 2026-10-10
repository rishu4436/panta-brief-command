import "server-only";

/**
 * Evidence layer for the AI Debate Arena. Builds the CLOSED set of evidence
 * items a debate may cite, from material our server reads itself:
 *
 *   panta_metadata         Panta's market record (question, category, phase, times)
 *   panta_resolution_rule  the resolution rule (creator-written; labelled so)
 *   onchain_event          the market's on-chain Event account (flags, times, slot)
 *   brief_signals          the AI Brief's deterministic signal summary
 *   declared_source        the market's declared sources of truth (on-chain /
 *                          Panta `oracle` URLs + https links in the rule),
 *                          fetched with the safe fetcher
 *   search_result          an optional, pluggable search provider (none by default)
 *   user_submitted         a link supplied with a claim challenge (safe fetcher)
 *
 * The model is not a source. If no search provider is configured we do not
 * pretend to research the web: the debate says so in its limitations.
 */

import { sanitizeUntrustedText } from "@/lib/brief-guard";
import type { ChainEvent } from "@/lib/panta/chain-events";
import type { Market } from "@/lib/panta/domain";
import { normalizeText, SafeFetchError, type SafeFetchResult } from "@/lib/net/safe-fetch";
import { DEBATE_LIMITS, type DebateEvidence, type Provenance, type Verification } from "./domain";
import { evidenceIdFor } from "./ids";

export const MAX_DECLARED_SOURCES = 3;
export const SOURCE_FETCH_TIMEOUT_MS = 6_000;
export const SOURCE_MAX_BYTES = 1_000_000;

export const NO_SEARCH_LIMITATION =
  "No external search provider is configured, so this debate doesn't include news or web research beyond the market's declared sources.";

/** Pluggable web search (docs/DEBATE_ARENA.md). Results are fetched with the safe fetcher like any other URL. */
export interface SearchProvider {
  readonly name: string;
  search(query: string, opts: { limit: number; signal: AbortSignal }): Promise<{ url: string; title: string }[]>;
}

/** No provider ships enabled; DEBATE_SEARCH_PROVIDER names one registered here. */
const SEARCH_PROVIDERS: Record<string, (env: Record<string, string | undefined>) => SearchProvider | null> = {};

export function configuredSearchProvider(env: Record<string, string | undefined> = process.env): SearchProvider | null {
  const name = (env.DEBATE_SEARCH_PROVIDER || "").trim().toLowerCase();
  if (!name || name === "none") return null;
  return SEARCH_PROVIDERS[name]?.(env) ?? null;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const isoDay = (sec: number | null | undefined) => (typeof sec === "number" && sec > 0 ? new Date(sec * 1000).toISOString().replace(".000Z", "Z") : null);

function item(input: {
  provenance: Provenance;
  verificationStatus: Verification;
  sourceUrl: string | null;
  sourceTitle: string;
  publisher: string;
  excerpt: string;
  retrievedAt: number;
  publishedAt?: number | null;
  note?: string | null;
}): DebateEvidence | null {
  const excerpt = cut(normalizeText(input.excerpt), DEBATE_LIMITS.excerpt);
  if (!excerpt) return null;
  return {
    evidenceId: evidenceIdFor(input.provenance, input.sourceUrl, excerpt),
    sourceUrl: input.sourceUrl,
    sourceTitle: cut(input.sourceTitle.trim() || "Untitled source", 300),
    publisher: cut(input.publisher.trim() || "Unknown publisher", 120),
    publishedAt: input.publishedAt ?? null,
    retrievedAt: input.retrievedAt,
    excerpt,
    provenance: input.provenance,
    verificationStatus: input.verificationStatus,
    note: input.note ? cut(input.note, 300) : null,
  };
}

/** https URLs declared as sources of truth (on-chain oracle first, then Panta's, then links in the rule). */
export function declaredSourceUrls(market: Pick<Market, "oracle" | "resolutionRule" | "description"> | null, chain: Pick<ChainEvent, "oracle" | "resolutionRule"> | null): string[] {
  const raw = [chain?.oracle, market?.oracle, chain?.resolutionRule, market?.resolutionRule, market?.description].filter((s): s is string => typeof s === "string" && s.length > 0);
  const out: string[] = [];
  for (const s of raw) {
    for (const m of s.matchAll(/https:\/\/[^\s,;"'<>()\]]+/gi)) {
      const u = m[0].replace(/[.)]+$/, "");
      try {
        const href = new URL(u).href;
        if (!out.includes(href)) out.push(href);
      } catch {
        /* not a URL */
      }
    }
  }
  return out.slice(0, MAX_DECLARED_SOURCES);
}

export const explorerAccountUrl = (marketId: string) => `https://solscan.io/account/${encodeURIComponent(marketId)}`;

/** Readable excerpt from a fetched page (JSON is flattened to "key: value" text). */
export function fetchedExcerpt(r: Pick<SafeFetchResult, "text" | "contentType">): string {
  if (r.contentType === "application/json") {
    try {
      const flat: string[] = [];
      const walk = (v: unknown, path: string, depth: number) => {
        if (flat.join(" ").length > DEBATE_LIMITS.excerpt) return;
        if (v === null || typeof v !== "object") {
          flat.push(`${path}: ${String(v)}`);
          return;
        }
        if (depth > 4) return;
        if (Array.isArray(v)) v.slice(0, 8).forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
        else for (const [k, x] of Object.entries(v).slice(0, 30)) walk(x, path ? `${path}.${k}` : k, depth + 1);
      };
      walk(JSON.parse(r.text), "", 0);
      return flat.join("; ");
    } catch {
      return r.text; // truncated or invalid JSON: raw text (labelled truncated by the caller)
    }
  }
  return r.text;
}

export type FetchedSource = { url: string; result: SafeFetchResult };

export function assembleEvidence(input: {
  marketId: string;
  market: Market | null;
  chain: { event: ChainEvent; slot: number } | null;
  briefText: string | null;
  sources: FetchedSource[];
  searchResults?: FetchedSource[];
  nowMs: number;
}): DebateEvidence[] {
  const { market, chain, nowMs } = input;
  const out: (DebateEvidence | null)[] = [];
  if (market) {
    const lines = [
      `Question: ${sanitizeUntrustedText(market.title, 300) || "(none)"}`,
      `Category: ${sanitizeUntrustedText(market.category, 60) || "unknown"}`,
      `Phase: ${market.phase || "unknown"}${market.status ? ` (status ${market.status})` : ""}`,
      market.resolved ? `Panta marks the market resolved${market.outcome ? ` (${market.outcome.toUpperCase()})` : ""}.` : "Panta does not mark the market resolved.",
      isoDay(market.startTime) ? `Event start: ${isoDay(market.startTime)}` : null,
      isoDay(market.endTime) ? `Event end: ${isoDay(market.endTime)}` : null,
      isoDay(market.primaryPhaseEndTime) ? `Primary (forecast) window ends: ${isoDay(market.primaryPhaseEndTime)}` : null,
      isoDay(market.resolutionTime) ? `Scheduled resolution time: ${isoDay(market.resolutionTime)}` : null,
      market.region ? `Region: ${sanitizeUntrustedText(market.region, 40)}` : null,
    ].filter(Boolean);
    out.push(item({ provenance: "panta_metadata", verificationStatus: "verified", sourceUrl: null, sourceTitle: "Panta market record", publisher: "Panta API", excerpt: lines.join("\n"), retrievedAt: nowMs }));
    const rule = sanitizeUntrustedText(chain?.event.resolutionRule || market.resolutionRule, DEBATE_LIMITS.excerpt);
    if (rule) out.push(item({ provenance: "panta_resolution_rule", verificationStatus: "verified", sourceUrl: null, sourceTitle: "Resolution rule", publisher: chain?.event.resolutionRule ? "Panta (on-chain market account)" : "Panta", excerpt: rule, retrievedAt: nowMs, note: "Written by the market's creator; it defines how the market resolves, not what will happen." }));
    const desc = sanitizeUntrustedText(market.description, DEBATE_LIMITS.excerpt);
    if (desc) out.push(item({ provenance: "panta_metadata", verificationStatus: "verified", sourceUrl: null, sourceTitle: "Market description", publisher: "Panta", excerpt: desc, retrievedAt: nowMs, note: "Written by the market's creator." }));
  }
  if (chain) {
    const e = chain.event;
    const lines = [
      `Account flags: active ${e.isActive}, graduated to secondary ${e.isGraduated}, resolved ${e.isResolved}, cancelled ${e.isCancelled}.`,
      e.isResolved && !e.isCancelled ? `Resolution recorded on-chain: ${e.yesWins ? "YES" : "NO"}.` : "No resolution recorded on-chain.",
      `Event end: ${isoDay(e.endTime) ?? "unknown"}; scheduled resolution: ${isoDay(e.resolutionTime) ?? "unknown"}.`,
      e.primaryPhaseEndTime ? `Primary window ends: ${isoDay(e.primaryPhaseEndTime)}.` : null,
      `Total trades recorded on the account: ${e.totalTrades}.`,
      `Read at slot ${chain.slot}.`,
    ].filter(Boolean);
    out.push(item({ provenance: "onchain_event", verificationStatus: "verified", sourceUrl: explorerAccountUrl(input.marketId), sourceTitle: "On-chain market (Event) account", publisher: "Solana mainnet", excerpt: lines.join("\n"), retrievedAt: nowMs, publishedAt: e.createdAt > 0 ? e.createdAt * 1000 : null, note: "publishedAt = when the account was created on-chain." }));
  }
  if (input.briefText) {
    out.push(item({ provenance: "brief_signals", verificationStatus: "verified", sourceUrl: null, sourceTitle: "AI Brief deterministic signals", publisher: "Brief Command (computed from Panta data)", excerpt: sanitizeUntrustedText(input.briefText.replace(/^#+\s*/gm, ""), DEBATE_LIMITS.excerpt), retrievedAt: nowMs, note: "Market-activity signals (prices, prints, volume). Prices are not forecasts of the outcome." }));
  }
  for (const s of input.sources) {
    const r = s.result;
    let host = "";
    try {
      host = new URL(r.url).hostname;
    } catch {
      host = "unknown";
    }
    const notes = [r.truncated ? `Truncated: only the first ${Math.round(r.bytes / 1000)} kB were read.` : null, r.redirects.length ? `Redirected to ${cut(r.url, 120)}.` : null].filter(Boolean).join(" ");
    out.push(item({ provenance: "declared_source", verificationStatus: "retrieved", sourceUrl: r.url, sourceTitle: r.title || `Declared source: ${host}`, publisher: host, excerpt: sanitizeUntrustedText(fetchedExcerpt(r), DEBATE_LIMITS.excerpt), retrievedAt: nowMs, note: notes || null }));
  }
  for (const s of input.searchResults ?? []) {
    const r = s.result;
    out.push(item({ provenance: "search_result", verificationStatus: "retrieved", sourceUrl: r.url, sourceTitle: r.title || r.url, publisher: new URL(r.url).hostname, excerpt: sanitizeUntrustedText(fetchedExcerpt(r), DEBATE_LIMITS.excerpt), retrievedAt: nowMs, note: r.truncated ? "Truncated." : null }));
  }
  const seen = new Set<string>();
  return out.filter((e): e is DebateEvidence => {
    if (!e || seen.has(e.evidenceId)) return false;
    seen.add(e.evidenceId);
    return true;
  }).slice(0, DEBATE_LIMITS.evidenceItems);
}

/** A user-submitted link (challenge) → one evidence item, or a SafeFetchError. */
export function userSourceEvidence(r: SafeFetchResult, nowMs: number): DebateEvidence {
  const host = new URL(r.url).hostname;
  const e = item({ provenance: "user_submitted", verificationStatus: "user_submitted", sourceUrl: r.url, sourceTitle: r.title || host, publisher: host, excerpt: sanitizeUntrustedText(fetchedExcerpt(r), DEBATE_LIMITS.excerpt), retrievedAt: nowMs, note: ["Submitted by a community member; not verified.", r.truncated ? "Truncated." : ""].filter(Boolean).join(" ") });
  if (!e) throw new SafeFetchError("CONTENT_TYPE_NOT_ALLOWED", "the page had no readable text");
  return e;
}

export const failureReason = (e: unknown): string => {
  if (e instanceof SafeFetchError) {
    const map: Record<string, string> = {
      TIMEOUT: "timed out",
      HTTP_ERROR: "the site returned an error",
      CONTENT_TYPE_NOT_ALLOWED: "not a readable page",
      DNS_FAILED: "host not found",
      ADDRESS_NOT_ALLOWED: "address not allowed",
      HOST_NOT_ALLOWED: "host not allowed",
      SCHEME_NOT_ALLOWED: "only https links are read",
      TOO_MANY_REDIRECTS: "too many redirects",
    };
    return map[e.code] ?? "couldn't be read";
  }
  return "couldn't be read";
};
