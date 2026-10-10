import "server-only";

/**
 * AI Debate Arena service: read a room's debate (never generates), generate a
 * new one on an explicit, authenticated request, and answer claim challenges.
 *
 * Who may generate: any wallet with a verified (SIWS) session, from this
 * site, within rate limits (routes), while the market is open or trading and
 * not resolved. A current debate is reused instead of regenerated; one
 * generation per room runs at a time (lock); a retried request with the same
 * Idempotency-Key returns the debate it produced.
 *
 * Nothing is persisted unless the model answered AND the answer passed
 * validation (schema, citations, guard rails). No model key → AI_UNAVAILABLE
 * before any source is fetched.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Lifecycle } from "@/lib/panta/catalog";
import type { SafeFetchResult } from "@/lib/net/safe-fetch";
import type { RoomRecord } from "@/lib/rooms/domain";
import { IdempotencyConflictError, type RoomRepository } from "@/lib/rooms/store/types";
import {
  DEBATE_IDEM_TTL_MS,
  DEBATE_KEEP_PER_ROOM,
  DEBATE_LIMITS,
  DEBATE_LOCK_TTL_MS,
  MAX_CHALLENGES_PER_CLAIM,
  MAX_CHALLENGES_PER_DEBATE,
  type DebateBundle,
  type DebateChallenge,
  type DebateEvidence,
  type DebateSummary,
} from "./domain";
import { failureReason, userSourceEvidence } from "./evidence";
import { challengeIdFor, debateIdFor, sourceSnapshotIdFor } from "./ids";
import type { DebateModel } from "./model";
import {
  CHALLENGE_MAX_OUTPUT_TOKENS,
  CHALLENGE_SYSTEM_PROMPT,
  CHALLENGE_TIMEOUT_MS,
  CHALLENGE_VERSION,
  DEBATE_SYSTEM_PROMPT,
  GENERATION_MAX_OUTPUT_TOKENS,
  GENERATION_TIMEOUT_MS,
  GENERATION_VERSION,
  buildChallengeInput,
  buildDebateInput,
} from "./prompts";
import { buildChallengeResponse, buildDebateFromModel, DebateValidationError } from "./validate";

// ------------------------------------------------------------------ deps

/** Bounded, page-view market state (never authorises generation). */
export type MarketView = { status: "ok"; lifecycle: Lifecycle; question: string | null } | { status: "unavailable" };

/** Fresh reads for a generation: the closed evidence set and the market state it was read with. */
export type GenerationSnapshot = {
  question: string;
  lifecycle: Lifecycle;
  evidence: DebateEvidence[];
  limitations: string[];
  sourceFailures: { url: string; reason: string }[];
};

export type DebateDeps = {
  repo: RoomRepository;
  model: DebateModel;
  now: () => number;
  readMarketView: (marketId: string) => Promise<MarketView>;
  /** null = the market couldn't be read (nothing is generated). */
  collect: (marketId: string, nowMs: number) => Promise<GenerationSnapshot | null>;
  fetchUserSource: (url: string) => Promise<SafeFetchResult>;
};

export class DebateError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "DebateError";
  }
}

export const DEBATE_TEXT = {
  aiUnavailable: "AI analysis isn't configured on this server, so no debate can be generated. Nothing was created.",
  resolved: "This market has resolved. Debates are kept as a pre-resolution record; no new ones are generated.",
  closed: "New debates are only generated while the market is open or trading.",
  marketUnavailable: "The market's status couldn't be checked right now, so no debate was generated. Try again shortly.",
  inProgress: "A debate for this room is being generated right now. It will appear here when it's ready.",
  failed: "The AI's answer didn't pass our evidence and safety checks, so nothing was saved. You can try again.",
  modelFailed: "The AI service didn't return a usable answer, so nothing was saved. You can try again.",
} as const;

// ------------------------------------------------------------------ view

export type Freshness = "current" | "stale" | "historical";

export type DebateView = {
  ai: { available: boolean; provider: string; model: string };
  market: { status: "ok" | "unavailable"; lifecycle: Lifecycle | null; resolved: boolean };
  generation: { allowed: boolean; reason: string | null };
  generating: boolean;
  debate: (DebateBundle & { freshness: Freshness; staleReasons: string[]; isLatest: boolean }) | null;
  requestedDebateMissing: boolean;
  challenges: DebateChallenge[];
  history: DebateSummary[];
  limits: { challengeMaxChars: number; challengeMinChars: number; challengesPerClaim: number };
};

const LIVE: readonly Lifecycle[] = ["open", "trading"];

async function marketState(deps: DebateDeps, room: RoomRecord) {
  const [view, fin] = await Promise.all([deps.readMarketView(room.marketId), deps.repo.getFinalization(room.marketId)]);
  const lifecycle = view.status === "ok" ? view.lifecycle : null;
  const resolved = lifecycle === "resolved" || fin?.status === "scored";
  let reason: string | null = null;
  if (resolved) reason = DEBATE_TEXT.resolved;
  else if (fin) reason = DEBATE_TEXT.closed;
  else if (view.status !== "ok") reason = DEBATE_TEXT.marketUnavailable;
  else if (!LIVE.includes(view.lifecycle)) reason = DEBATE_TEXT.closed;
  return { view, lifecycle, resolved, finalized: Boolean(fin), allowed: reason === null, reason };
}

export function freshnessOf(d: DebateBundle["debate"], ctx: { nowMs: number; lifecycle: Lifecycle | null; resolved: boolean; isLatest: boolean }): { freshness: Freshness; reasons: string[] } {
  if (ctx.resolved) return { freshness: "historical", reasons: ["Generated before the market resolved."] };
  const reasons: string[] = [];
  if (!ctx.isLatest) reasons.push("A newer debate exists for this room.");
  if (ctx.nowMs > d.expiresAt) reasons.push("Older than its 6-hour freshness window.");
  if (ctx.lifecycle && ctx.lifecycle !== d.lifecycleAtGeneration) reasons.push(`The market moved from ${d.lifecycleAtGeneration} to ${ctx.lifecycle} since it was generated.`);
  if (d.generationVersion !== GENERATION_VERSION) reasons.push("Generated by an older version of the debate prompts.");
  return { freshness: reasons.length ? "stale" : "current", reasons };
}

export async function readDebateView(deps: DebateDeps, room: RoomRecord, opts: { debateId?: string | null }): Promise<DebateView> {
  const now = deps.now();
  const [state, latest, history, generating] = await Promise.all([
    marketState(deps, room),
    deps.repo.getLatestDebate(room.roomId),
    deps.repo.listDebates(room.roomId, { limit: DEBATE_KEEP_PER_ROOM }),
    deps.repo.isDebateLocked(room.roomId),
  ]);
  let chosen = latest;
  let missing = false;
  if (opts.debateId && opts.debateId !== latest?.debate.debateId) {
    const d = await deps.repo.getDebate(room.roomId, opts.debateId);
    if (d) chosen = d;
    else missing = true;
  }
  const isLatest = Boolean(chosen && latest && chosen.debate.debateId === latest.debate.debateId);
  const challenges = chosen ? await deps.repo.listChallenges(room.roomId, chosen.debate.debateId, { limit: MAX_CHALLENGES_PER_DEBATE }) : [];
  const f = chosen ? freshnessOf(chosen.debate, { nowMs: now, lifecycle: state.lifecycle, resolved: state.resolved, isLatest }) : null;
  return {
    ai: { available: deps.model.available(), provider: deps.model.provider, model: deps.model.model },
    market: { status: state.view.status, lifecycle: state.lifecycle, resolved: state.resolved },
    generation: { allowed: state.allowed && deps.model.available(), reason: !deps.model.available() ? DEBATE_TEXT.aiUnavailable : state.reason },
    generating,
    debate: chosen && f ? { ...chosen, freshness: f.freshness, staleReasons: f.reasons, isLatest } : null,
    requestedDebateMissing: missing,
    challenges,
    history,
    limits: { challengeMaxChars: DEBATE_LIMITS.challengeText, challengeMinChars: DEBATE_LIMITS.challengeMin, challengesPerClaim: MAX_CHALLENGES_PER_CLAIM },
  };
}

// ------------------------------------------------------------------ generate

export type GenerateResult = { status: "created" | "reused"; debateId: string };

const isReusable = (d: DebateBundle["debate"], nowMs: number, lifecycle: Lifecycle | null) =>
  nowMs <= d.expiresAt && d.generationVersion === GENERATION_VERSION && (lifecycle === null || lifecycle === d.lifecycleAtGeneration);

export async function generateDebate(deps: DebateDeps, room: RoomRecord, idempotencyKey: string): Promise<GenerateResult> {
  if (!deps.model.available()) throw new DebateError(503, "AI_UNAVAILABLE", DEBATE_TEXT.aiUnavailable);

  const prior = await deps.repo.findDebateByIdempotencyKey(room.roomId, idempotencyKey);
  if (prior && (await deps.repo.getDebate(room.roomId, prior))) return { status: "reused", debateId: prior };

  const state = await marketState(deps, room);
  if (state.resolved) throw new DebateError(409, "MARKET_RESOLVED", DEBATE_TEXT.resolved);
  if (state.finalized) throw new DebateError(409, "GENERATION_CLOSED", DEBATE_TEXT.closed);
  if (state.view.status === "ok" && !LIVE.includes(state.view.lifecycle)) throw new DebateError(409, "GENERATION_CLOSED", DEBATE_TEXT.closed);

  const latest = await deps.repo.getLatestDebate(room.roomId);
  if (latest && isReusable(latest.debate, deps.now(), state.lifecycle)) return { status: "reused", debateId: latest.debate.debateId };

  const token = randomBytes(16).toString("hex");
  if (!(await deps.repo.acquireDebateLock(room.roomId, token, DEBATE_LOCK_TTL_MS))) {
    throw new DebateError(409, "GENERATION_IN_PROGRESS", DEBATE_TEXT.inProgress);
  }
  try {
    // Re-check under the lock: another request may have just finished.
    const again = await deps.repo.getLatestDebate(room.roomId);
    if (again && isReusable(again.debate, deps.now(), state.lifecycle)) return { status: "reused", debateId: again.debate.debateId };

    const snap = await deps.collect(room.marketId, deps.now());
    if (!snap) throw new DebateError(503, "MARKET_UNAVAILABLE", DEBATE_TEXT.marketUnavailable);
    if (snap.lifecycle === "resolved") throw new DebateError(409, "MARKET_RESOLVED", DEBATE_TEXT.resolved);
    if (!LIVE.includes(snap.lifecycle)) throw new DebateError(409, "GENERATION_CLOSED", DEBATE_TEXT.closed);

    const snapshotId = sourceSnapshotIdFor(snap.evidence, snap.lifecycle, GENERATION_VERSION);
    if (again && again.debate.sourceSnapshotId === snapshotId && isReusable(again.debate, deps.now(), snap.lifecycle)) {
      return { status: "reused", debateId: again.debate.debateId };
    }

    const createdAt = deps.now();
    const debateId = debateIdFor(room.roomId, snapshotId, GENERATION_VERSION, createdAt, token);
    const call = await deps.model.complete({
      system: DEBATE_SYSTEM_PROMPT,
      user: buildDebateInput({ question: snap.question, lifecycle: snap.lifecycle, evidence: snap.evidence, limitations: snap.limitations, nowMs: createdAt }),
      maxOutputTokens: GENERATION_MAX_OUTPUT_TOKENS,
      timeoutMs: GENERATION_TIMEOUT_MS,
    });
    if (call.kind === "unavailable") throw new DebateError(503, "AI_UNAVAILABLE", DEBATE_TEXT.aiUnavailable);
    if (call.kind === "failed") {
      console.warn("[debate] model call failed", call.reason);
      throw new DebateError(502, "GENERATION_FAILED", DEBATE_TEXT.modelFailed);
    }
    let bundle: DebateBundle;
    try {
      bundle = buildDebateFromModel(call.content, {
        debateId,
        roomId: room.roomId,
        marketId: room.marketId,
        generationVersion: GENERATION_VERSION,
        sourceSnapshotId: snapshotId,
        createdAt,
        lifecycle: snap.lifecycle,
        question: snap.question,
        model: { provider: deps.model.provider, model: deps.model.model },
        evidence: snap.evidence,
        limitations: snap.limitations,
        sourceFailures: snap.sourceFailures,
      });
    } catch (e) {
      if (e instanceof DebateValidationError) {
        console.warn("[debate] model output rejected", e.reason);
        throw new DebateError(502, "GENERATION_FAILED", DEBATE_TEXT.failed);
      }
      throw e;
    }
    const saved = await deps.repo.saveDebate(bundle, { idempotencyKey, keepLast: DEBATE_KEEP_PER_ROOM, idemTtlMs: DEBATE_IDEM_TTL_MS });
    return { status: saved.status === "created" ? "created" : "reused", debateId: saved.debateId };
  } finally {
    await deps.repo.releaseDebateLock(room.roomId, token).catch(() => undefined);
  }
}


// ------------------------------------------------------------------ challenges

export type ChallengeInput = { debateId: string; claimId: string; text: string; sourceUrl?: string | null; idempotencyKey: string };
export type ChallengeResult = { status: "created" | "replayed"; challenge: DebateChallenge };

export const challengeFingerprint = (i: ChallengeInput) =>
  createHash("sha256").update(JSON.stringify([i.debateId, i.claimId, i.text, i.sourceUrl ?? ""])).digest("hex");

/** Plain text only: control characters are removed; length is checked after trimming. */
export function cleanChallengeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "")
    .trim();
}

export async function challengeClaim(deps: DebateDeps, room: RoomRecord, wallet: string, input: ChallengeInput): Promise<ChallengeResult> {
  const fingerprint = challengeFingerprint(input);
  const prior = await deps.repo.findChallengeByIdempotencyKey(room.roomId, wallet, input.idempotencyKey);
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new IdempotencyConflictError();
    return { status: "replayed", challenge: prior.challenge };
  }
  if (!deps.model.available()) throw new DebateError(503, "AI_UNAVAILABLE", "AI analysis isn't configured on this server, so challenges can't be answered. Nothing was saved.");

  const latest = await deps.repo.getLatestDebate(room.roomId);
  if (!latest) throw new DebateError(404, "DEBATE_NOT_FOUND", "This room has no debate to challenge.");
  if (latest.debate.debateId !== input.debateId) {
    const old = await deps.repo.getDebate(room.roomId, input.debateId);
    if (!old) throw new DebateError(404, "DEBATE_NOT_FOUND", "That debate doesn't exist in this room.");
    throw new DebateError(409, "DEBATE_NOT_CURRENT", "Only the room's latest debate can be challenged. Reload to see it.");
  }
  const claim = latest.claims.find((c) => c.claimId === input.claimId);
  if (!claim) throw new DebateError(404, "CLAIM_NOT_FOUND", "That claim isn't part of this debate.");

  const state = await marketState(deps, room);
  if (state.resolved) throw new DebateError(409, "MARKET_RESOLVED", "This market has resolved; its debate is a read-only pre-resolution record.");

  // Don't spend a model call on a challenge the store would refuse.
  const existing = await deps.repo.listChallenges(room.roomId, latest.debate.debateId, { limit: MAX_CHALLENGES_PER_DEBATE });
  if (existing.length >= MAX_CHALLENGES_PER_DEBATE) throw new DebateError(409, "CHALLENGE_LIMIT", "This debate has reached its challenge limit.");
  if (existing.filter((c) => c.claimId === claim.claimId).length >= MAX_CHALLENGES_PER_CLAIM) {
    throw new DebateError(409, "CHALLENGE_LIMIT", "This claim has reached its challenge limit.");
  }

  const now = deps.now();
  let userEvidence: DebateEvidence | null = null;
  if (input.sourceUrl) {
    try {
      userEvidence = userSourceEvidence(await deps.fetchUserSource(input.sourceUrl), now);
    } catch (e) {
      throw new DebateError(422, "SOURCE_UNREADABLE", `Your link couldn't be used (${failureReason(e)}). Nothing was saved.`);
    }
  }
  const allowed = userEvidence ? [...latest.evidence, userEvidence] : latest.evidence;
  const call = await deps.model.complete({
    system: CHALLENGE_SYSTEM_PROMPT,
    user: buildChallengeInput({ question: latest.debate.marketQuestion, claim, challengeText: input.text, evidence: allowed, nowMs: now }),
    maxOutputTokens: CHALLENGE_MAX_OUTPUT_TOKENS,
    timeoutMs: CHALLENGE_TIMEOUT_MS,
  });
  if (call.kind === "unavailable") throw new DebateError(503, "AI_UNAVAILABLE", "AI analysis is unavailable right now. Nothing was saved.");
  if (call.kind === "failed") {
    console.warn("[debate] challenge model call failed", call.reason);
    throw new DebateError(502, "CHALLENGE_FAILED", "The AI service didn't return a usable answer. Nothing was saved; you can try again.");
  }
  let response: ReturnType<typeof buildChallengeResponse>;
  try {
    response = buildChallengeResponse(call.content, allowed, latest.debate.marketQuestion);
  } catch (e) {
    if (e instanceof DebateValidationError) {
      console.warn("[debate] challenge output rejected", e.reason);
      throw new DebateError(502, "CHALLENGE_FAILED", "The AI's answer didn't pass our evidence and safety checks. Nothing was saved; you can try again.");
    }
    throw e;
  }
  const challenge: DebateChallenge = {
    challengeId: challengeIdFor(input.debateId, input.claimId, wallet, input.idempotencyKey),
    debateId: input.debateId,
    claimId: input.claimId,
    wallet,
    challengeText: input.text,
    response: { verdict: response.verdict, text: response.text, evidenceRefs: response.evidenceRefs },
    responseEvidence: userEvidence ? [userEvidence] : [],
    generationVersion: CHALLENGE_VERSION,
    model: { provider: deps.model.provider, model: deps.model.model },
    createdAt: now,
  };
  return deps.repo.addChallenge(room.roomId, challenge, {
    idempotencyKey: input.idempotencyKey,
    fingerprint,
    maxPerClaim: MAX_CHALLENGES_PER_CLAIM,
    maxPerDebate: MAX_CHALLENGES_PER_DEBATE,
    idemTtlMs: DEBATE_IDEM_TTL_MS,
  });
}
