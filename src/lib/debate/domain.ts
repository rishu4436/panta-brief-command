/**
 * AI Debate Arena — domain model (shared by server, storage and UI).
 *
 * A debate is an immutable, versioned snapshot for one room: a YES case, a NO
 * case, claim-level citations into a closed evidence set, and an Evidence
 * Referee. It is research assistance: never a probability, a winner, advice,
 * a resolution or a trade. Every evidence item comes from a source we read
 * ourselves (Panta, the chain, deterministic signals, fetched source pages);
 * the model is never a source and may only cite evidence ids from the set.
 *
 * Panta's market record isn't copied wholesale: a debate stores the marketId
 * and the short excerpts the model saw (so citations stay checkable even
 * after the market changes).
 */

import { z } from "@/lib/zod";
import { IDEMPOTENCY_KEY_RE } from "@/lib/rooms/domain";

export const SIDES = ["yes", "no"] as const;
export type Side = (typeof SIDES)[number];

export const CLAIM_KINDS = ["verified_fact", "source_supported_interpretation", "hypothesis", "unknown"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export const CLAIM_KIND_LABEL: Record<ClaimKind, string> = {
  verified_fact: "Verified fact",
  source_supported_interpretation: "Source-supported interpretation",
  hypothesis: "Hypothesis",
  unknown: "Unknown",
};

export const UNCERTAINTY = ["low", "medium", "high"] as const;
export type Uncertainty = (typeof UNCERTAINTY)[number];

/** Set by validation + referee, never by the model alone. */
export const CLAIM_STATUSES = ["supported", "unsupported", "flagged"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const SUFFICIENCY = ["supported", "limited", "insufficient"] as const;
export type Sufficiency = (typeof SUFFICIENCY)[number];

export const PROVENANCE = [
  "panta_metadata",
  "panta_resolution_rule",
  "onchain_event",
  "brief_signals",
  "declared_source",
  "search_result",
  "user_submitted",
] as const;
export type Provenance = (typeof PROVENANCE)[number];
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  panta_metadata: "Panta market record",
  panta_resolution_rule: "Resolution rule (Panta)",
  onchain_event: "On-chain market account",
  brief_signals: "AI Brief signals (deterministic)",
  declared_source: "Declared source of truth",
  search_result: "Search result",
  user_submitted: "User-submitted source",
};

/**
 * verified       read directly by our server from Panta's API or the chain
 * retrieved      fetched from the cited URL; content as retrieved, not independently verified
 * user_submitted fetched from a link a user supplied with a challenge
 */
export const VERIFICATION = ["verified", "retrieved", "user_submitted"] as const;
export type Verification = (typeof VERIFICATION)[number];

export const EVIDENCE_QUALITY = ["strong", "moderate", "thin"] as const;
export const CHALLENGE_VERDICTS = ["claim_stands", "claim_weakened", "claim_unsupported", "insufficient_evidence"] as const;
export type ChallengeVerdict = (typeof CHALLENGE_VERDICTS)[number];
export const CHALLENGE_VERDICT_LABEL: Record<ChallengeVerdict, string> = {
  claim_stands: "Claim stands on the evidence",
  claim_weakened: "Claim weakened",
  claim_unsupported: "Claim not supported by the evidence",
  insufficient_evidence: "Evidence insufficient to decide",
};

export const DEBATE_STATUSES = ["ready", "insufficient_evidence"] as const;
export type DebateStatus = (typeof DEBATE_STATUSES)[number];

// ------------------------------------------------------------------ limits

export const DEBATE_LIMITS = {
  claimsPerSide: 5,
  refsPerClaim: 4,
  claimText: 400,
  rationale: 600,
  thesis: 600,
  note: 400,
  listItems: 5,
  listItem: 300,
  evidenceItems: 16,
  excerpt: 1500,
  challengeText: 500,
  challengeMin: 10,
  challengeResponse: 900,
  url: 500,
} as const;

/** Fresh for 6 h; after that (or when the market's lifecycle changes) it's shown as stale. */
export const DEBATE_TTL_MS = 6 * 3600_000;
/** Keep the newest K debates per room (older ones and their challenges are deleted). */
export const DEBATE_KEEP_PER_ROOM = 5;
export const MAX_CHALLENGES_PER_CLAIM = 10;
export const MAX_CHALLENGES_PER_DEBATE = 60;
/** Generation lock (single flight per room). */
export const DEBATE_LOCK_TTL_MS = 120_000;
export const DEBATE_IDEM_TTL_MS = 24 * 3600_000;

// ------------------------------------------------------------------ schemas

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-f0-9]{8,32}$`));
export const EvidenceId = id("ev");
export const ClaimId = id("clm");
export const DebateId = id("dbt");
export const ChallengeId = id("chl");
const ts = z.number().int().nonnegative();

export const DebateEvidenceSchema = z
  .object({
    evidenceId: EvidenceId,
    sourceUrl: z.string().url().max(DEBATE_LIMITS.url).nullable(),
    sourceTitle: text(300),
    publisher: text(120),
    /** Only when verified (e.g. an on-chain timestamp); null = unknown. */
    publishedAt: ts.nullable(),
    retrievedAt: ts,
    excerpt: text(DEBATE_LIMITS.excerpt),
    provenance: z.enum(PROVENANCE),
    verificationStatus: z.enum(VERIFICATION),
    note: z.string().max(300).nullable(),
  })
  .strict();
export type DebateEvidence = z.infer<typeof DebateEvidenceSchema>;

export const DebateClaimSchema = z
  .object({
    claimId: ClaimId,
    debateId: DebateId,
    side: z.enum(SIDES),
    claimText: text(DEBATE_LIMITS.claimText),
    rationale: z.string().trim().max(DEBATE_LIMITS.rationale),
    evidenceRefs: z.array(EvidenceId).max(DEBATE_LIMITS.refsPerClaim),
    uncertainty: z.enum(UNCERTAINTY),
    kind: z.enum(CLAIM_KINDS),
    status: z.enum(CLAIM_STATUSES),
    flags: z.array(z.string().max(60)).max(6),
  })
  .strict();
export type DebateClaim = z.infer<typeof DebateClaimSchema>;

const listOf = (max: number = DEBATE_LIMITS.listItems) => z.array(text(DEBATE_LIMITS.listItem)).max(max);

export const SideCaseSchema = z
  .object({
    thesis: z.string().trim().max(DEBATE_LIMITS.thesis),
    sufficiency: z.enum(SUFFICIENCY),
    sufficiencyNote: z.string().trim().max(DEBATE_LIMITS.note),
    claimIds: z.array(ClaimId).max(DEBATE_LIMITS.claimsPerSide),
    assumptions: listOf(4),
    invalidators: listOf(4),
  })
  .strict();
export type SideCase = z.infer<typeof SideCaseSchema>;

export const RefereeSchema = z
  .object({
    overview: z.string().trim().max(DEBATE_LIMITS.thesis),
    evidenceQuality: z.enum(EVIDENCE_QUALITY),
    unsupportedClaims: z.array(z.object({ claimId: ClaimId, note: text(DEBATE_LIMITS.note) }).strict()).max(12),
    contradictions: z.array(z.object({ claimIds: z.array(ClaimId).min(1).max(4), note: text(DEBATE_LIMITS.note) }).strict()).max(8),
    weakEvidence: z.array(z.object({ evidenceId: EvidenceId, note: text(DEBATE_LIMITS.note) }).strict()).max(8),
    missingInformation: listOf(8),
    sourceBias: z.array(z.object({ evidenceId: EvidenceId.nullable(), note: text(DEBATE_LIMITS.note) }).strict()).max(6),
    wouldChangeAnalysis: listOf(6),
    agreement: listOf(5),
  })
  .strict();
export type Referee = z.infer<typeof RefereeSchema>;

export const DebateSchema = z
  .object({
    debateId: DebateId,
    roomId: z.string().min(1).max(64),
    marketId: z.string().min(32).max(44),
    generationVersion: text(40),
    sourceSnapshotId: z.string().regex(/^src_[a-f0-9]{24}$/),
    status: z.enum(DEBATE_STATUSES),
    createdAt: ts,
    expiresAt: ts,
    /** Market lifecycle when generated (stale once it changes). */
    lifecycleAtGeneration: z.string().max(20),
    /** The market question as shown to the model (for the historical record). */
    marketQuestion: text(300),
    model: z.object({ provider: text(40), model: text(80) }).strict(),
    yes: SideCaseSchema,
    no: SideCaseSchema,
    referee: RefereeSchema,
    limitations: listOf(8),
    sourceFailures: z.array(z.object({ url: z.string().max(DEBATE_LIMITS.url), reason: text(120) }).strict()).max(8),
  })
  .strict();
export type Debate = z.infer<typeof DebateSchema>;

export const DebateBundleSchema = z
  .object({
    debate: DebateSchema,
    claims: z.array(DebateClaimSchema).max(DEBATE_LIMITS.claimsPerSide * 2),
    evidence: z.array(DebateEvidenceSchema).max(DEBATE_LIMITS.evidenceItems),
  })
  .strict()
  .superRefine((b, ctx) => {
    const ev = new Set(b.evidence.map((e) => e.evidenceId));
    const cl = new Set(b.claims.map((c) => c.claimId));
    if (ev.size !== b.evidence.length) ctx.addIssue({ code: "custom", message: "duplicate evidence id" });
    if (cl.size !== b.claims.length) ctx.addIssue({ code: "custom", message: "duplicate claim id" });
    for (const c of b.claims) {
      if (c.debateId !== b.debate.debateId) ctx.addIssue({ code: "custom", message: "claim from another debate" });
      for (const r of c.evidenceRefs) if (!ev.has(r)) ctx.addIssue({ code: "custom", message: `claim cites unknown evidence ${r}` });
    }
    for (const s of SIDES) for (const cid of b.debate[s].claimIds) if (!cl.has(cid)) ctx.addIssue({ code: "custom", message: `side lists unknown claim ${cid}` });
  });
export type DebateBundle = z.infer<typeof DebateBundleSchema>;

export const ChallengeResponseSchema = z
  .object({
    verdict: z.enum(CHALLENGE_VERDICTS),
    text: text(DEBATE_LIMITS.challengeResponse),
    evidenceRefs: z.array(EvidenceId).max(6),
  })
  .strict();

export const DebateChallengeSchema = z
  .object({
    challengeId: ChallengeId,
    debateId: DebateId,
    claimId: ClaimId,
    wallet: z.string().min(32).max(44),
    challengeText: text(DEBATE_LIMITS.challengeText, DEBATE_LIMITS.challengeMin),
    response: ChallengeResponseSchema,
    /** User-submitted source fetched for this challenge (at most one). */
    responseEvidence: z.array(DebateEvidenceSchema).max(1),
    generationVersion: text(40),
    model: z.object({ provider: text(40), model: text(80) }).strict(),
    createdAt: ts,
  })
  .strict();
export type DebateChallenge = z.infer<typeof DebateChallengeSchema>;

export type DebateSummary = { debateId: string; createdAt: number; expiresAt: number; status: DebateStatus; generationVersion: string };

/** Client-safe anchor ids. */
export const claimAnchor = (claimId: string) => `claim-${claimId}`;

// ------------------------------------------------------------------ request bodies (routes)

export const GenerateDebateInput = z.object({ idempotencyKey: z.string().regex(IDEMPOTENCY_KEY_RE, "Invalid idempotency key.") }).strict();

export const ChallengeClaimInput = z
  .object({
    debateId: DebateId,
    claimId: ClaimId,
    text: z.string().max(DEBATE_LIMITS.challengeText * 2),
    sourceUrl: z.string().trim().max(DEBATE_LIMITS.url).nullable().optional(),
    idempotencyKey: z.string().regex(IDEMPOTENCY_KEY_RE, "Invalid idempotency key."),
  })
  .strict();
export type ChallengeClaimInput = z.infer<typeof ChallengeClaimInput>;

export const DEBATE_ID_RE = /^dbt_[a-f0-9]{8,32}$/;
