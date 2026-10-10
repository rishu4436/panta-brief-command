import "server-only";

/**
 * Live dependencies for the debate routes. Tests replace ONLY the model
 * boundary, the evidence collection and the clock (__setDebateDepsForTests);
 * storage, validation and the route logic are the real code.
 */

import { buildTemplateBrief } from "@/lib/brief";
import { getMarketSnapshot } from "@/lib/embed/market-snapshot";
import { safeFetch } from "@/lib/net/safe-fetch";
import { applyChainEvent, marketLifecycle } from "@/lib/panta/catalog";
import { getAuthoritativeMarket } from "@/lib/panta/catalog-server";
import { readEventAccountFresh } from "@/lib/panta/chain-event-server";
import type { Market } from "@/lib/panta/domain";
import { sanitizeMarket } from "@/lib/panta/sanitize";
import { getMarketTradesServer } from "@/lib/panta/server";
import { computeMarketSignals } from "@/lib/panta/signals";
import { roomRepository } from "@/lib/rooms/store";
import {
  MAX_DECLARED_SOURCES,
  NO_SEARCH_LIMITATION,
  SOURCE_FETCH_TIMEOUT_MS,
  SOURCE_MAX_BYTES,
  assembleEvidence,
  configuredSearchProvider,
  declaredSourceUrls,
  failureReason,
  type FetchedSource,
} from "./evidence";
import { openAiDebateModel, type DebateModel } from "./model";
import type { DebateDeps, GenerationSnapshot, MarketView } from "./service";

const MARKET_READ_BUDGET_MS = 12_000;
const TAPE_ROWS = 50;

const within = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

async function liveMarketView(marketId: string): Promise<MarketView> {
  const snap = await getMarketSnapshot(marketId);
  if (!snap.market) return { status: "unavailable" };
  return { status: "ok", lifecycle: snap.sourcesAgreeResolved ? "resolved" : marketLifecycle(snap.market), question: snap.market.title || null };
}

async function fetchSources(urls: string[]): Promise<{ ok: FetchedSource[]; failed: { url: string; reason: string }[] }> {
  const settled = await Promise.all(
    urls.map(async (url) => {
      try {
        return { url, result: await safeFetch(url, { timeoutMs: SOURCE_FETCH_TIMEOUT_MS, maxBytes: SOURCE_MAX_BYTES }) };
      } catch (e) {
        return { url, error: failureReason(e) };
      }
    }),
  );
  const ok: FetchedSource[] = [];
  const failed: { url: string; reason: string }[] = [];
  for (const s of settled) {
    if ("result" in s && s.result) ok.push({ url: s.url, result: s.result });
    else failed.push({ url: s.url, reason: "error" in s ? s.error : "couldn't be read" });
  }
  return { ok, failed };
}

/** Fresh, bounded reads for one generation. */
async function liveCollect(marketId: string, nowMs: number): Promise<GenerationSnapshot | null> {
  const [chain, authoritative, tape] = await Promise.all([
    readEventAccountFresh(marketId),
    within(getAuthoritativeMarket(marketId), MARKET_READ_BUDGET_MS),
    within(getMarketTradesServer(marketId, TAPE_ROWS), MARKET_READ_BUDGET_MS),
  ]);
  const chainOk = chain.status === "ok";
  if (!chainOk && !authoritative) return null;
  const merged: Market = sanitizeMarket(chainOk ? applyChainEvent(authoritative ?? undefined, chain.event) : (authoritative as Market));
  const lifecycle = marketLifecycle(merged);
  const limitations: string[] = [];

  let briefText: string | null = null;
  if (tape) {
    const signals = computeMarketSignals(merged, tape.trades.slice(0, TAPE_ROWS), nowMs, { tapeCompleteness: tape.completeness });
    briefText = buildTemplateBrief(merged, signals, "desk");
  } else limitations.push("Panta's trade history couldn't be read, so market-activity signals aren't included.");
  if (!chainOk) limitations.push("The on-chain market account couldn't be read; Panta's record was used alone.");

  const urls = declaredSourceUrls(merged, chainOk ? chain.event : null).slice(0, MAX_DECLARED_SOURCES);
  if (!urls.length) limitations.push("The market declares no readable https source of truth.");
  const declared = await fetchSources(urls);

  let searchResults: FetchedSource[] = [];
  const provider = configuredSearchProvider();
  if (provider) {
    try {
      const hits = await provider.search(merged.title, { limit: 3, signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS) });
      const fetched = await fetchSources(hits.slice(0, 3).map((h) => h.url));
      searchResults = fetched.ok;
      declared.failed.push(...fetched.failed);
    } catch {
      limitations.push(`The search provider (${provider.name}) didn't respond, so no web results are included.`);
    }
  } else limitations.push(NO_SEARCH_LIMITATION);

  const evidence = assembleEvidence({
    marketId,
    market: merged,
    chain: chainOk ? { event: chain.event, slot: chain.slot } : null,
    briefText,
    sources: declared.ok,
    searchResults,
    nowMs,
  });
  return { question: merged.title || "(untitled market)", lifecycle, evidence, limitations, sourceFailures: declared.failed.slice(0, 8) };
}

let override: Partial<Pick<DebateDeps, "model" | "collect" | "readMarketView" | "fetchUserSource" | "now">> = {};

export function debateDeps(): DebateDeps {
  return {
    repo: roomRepository(),
    model: override.model ?? openAiDebateModel(),
    now: override.now ?? Date.now,
    readMarketView: override.readMarketView ?? liveMarketView,
    collect: override.collect ?? liveCollect,
    fetchUserSource: override.fetchUserSource ?? ((url) => safeFetch(url, { timeoutMs: SOURCE_FETCH_TIMEOUT_MS, maxBytes: SOURCE_MAX_BYTES })),
  };
}

/** Tests only. */
export function __setDebateDepsForTests(o: Partial<Pick<DebateDeps, "model" | "collect" | "readMarketView" | "fetchUserSource" | "now">> & { model?: DebateModel }) {
  override = o;
}
