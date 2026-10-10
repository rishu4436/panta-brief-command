import "server-only";

/**
 * Model output → stored debate / challenge, or a rejection. Nothing the model
 * returns is trusted:
 *
 *  - strict schema (lengths, counts, enums) — ModelDebateOutput / ModelChallengeOutput;
 *  - text guards on every string: advice language, prompt-injection echoes,
 *    probability / odds / winner language, percentages not present in the
 *    evidence, and ANY URL or domain → rejected (the UI links sources itself);
 *  - citations: ids not in the evidence set are removed and the claim is
 *    flagged; too many invented ids → the whole answer is rejected;
 *  - claim status is decided here, not by the model: a "verified fact" or
 *    "interpretation" with no valid evidence is unsupported;
 *  - the deterministic referee adds what the model missed (unsupported and
 *    flagged claims, sources read both ways, failed sources).
 */

import { containsAdvice } from "@/lib/brief-guard";
import {
  DEBATE_LIMITS,
  DEBATE_TTL_MS,
  DebateBundleSchema,
  SIDES,
  type ChallengeVerdict,
  type DebateBundle,
  type DebateClaim,
  type DebateEvidence,
  type Referee,
  type Side,
} from "./domain";
import { claimIdFor } from "./ids";
import { ModelChallengeOutput, ModelDebateOutput } from "./prompts";

export class DebateValidationError extends Error {
  constructor(public reason: string) {
    super(`model output rejected: ${reason}`);
    this.name = "DebateValidationError";
  }
}

// ------------------------------------------------------------------ text guards

const INJECTION_ECHO_RE =
  /\b(ignore (?:all |the |any )?(?:previous|prior|above|earlier) (?:instructions|rules|prompts?)|system prompt|developer (?:message|prompt)|as an ai\b|new instructions|disregard (?:the |all )?(?:rules|instructions)|you are now|jailbreak)/i;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|gov|edu|co|uk|market|app|ai|info|news|xyz)\b(?:\/\S*)?/i;
/** Likelihood / verdict language the arena must never produce. */
const PROBABILITY_RE =
  /(\d+(?:\.\d+)?\s?%\s*(?:likely|chance|probability|odds|confiden\w*|certain\w*))|((?:probabilit\w*|chances?|odds|likelihood|confidence)\s+(?:of|that|is|for|at|around|about|near)\b[^.\n]{0,30}?\d)|(\b\d+\s*(?:in|out of)\s*\d+\s+chance)|(\b(?:yes|no)\b\s+(?:is|looks|seems|appears)\s+(?:\w+\s+)?(?:likely|unlikely|favou?red|the (?:better|stronger) bet))|(\b(?:will|is going to|should)\s+(?:almost\s+)?(?:certainly|definitely|surely)\s+resolve)|(\b(?:winner|wins) (?:of )?(?:this|the) debate\b)|(\b(?:the )?(?:yes|no) (?:side|case) wins\b)/i;
const PCT_RE = /\d+(?:\.\d+)?\s?%/g;

function pctForms(evidenceText: string): Set<string> {
  const out = new Set<string>();
  for (const m of evidenceText.matchAll(PCT_RE)) out.add(m[0].replace(/\s/g, ""));
  return out;
}

/** Throws DebateValidationError for the first guard a string fails. */
export function guardText(textIn: string, allowedPct: Set<string>, where: string): void {
  const t = textIn.normalize("NFKC");
  if (!t.trim()) return;
  if (containsAdvice(t)) throw new DebateValidationError(`advice:${where}`);
  if (INJECTION_ECHO_RE.test(t)) throw new DebateValidationError(`injection_echo:${where}`);
  if (URL_RE.test(t)) throw new DebateValidationError(`url_not_in_evidence:${where}`);
  if (PROBABILITY_RE.test(t)) throw new DebateValidationError(`probability_or_verdict:${where}`);
  for (const m of t.matchAll(PCT_RE)) if (!allowedPct.has(m[0].replace(/\s/g, ""))) throw new DebateValidationError(`percentage_not_in_evidence:${where}`);
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new DebateValidationError("not_json");
  }
}

// ------------------------------------------------------------------ debate

export type DebateBuildContext = {
  debateId: string;
  roomId: string;
  marketId: string;
  generationVersion: string;
  sourceSnapshotId: string;
  createdAt: number;
  lifecycle: string;
  question: string;
  model: { provider: string; model: string };
  evidence: DebateEvidence[];
  limitations: string[];
  sourceFailures: { url: string; reason: string }[];
};

/** Max invented citations before the whole answer is thrown away. */
const MAX_HALLUCINATED_REFS = 2;

export function buildDebateFromModel(raw: unknown, ctx: DebateBuildContext): DebateBundle {
  const parsed = ModelDebateOutput.safeParse(parseJson(raw));
  if (!parsed.success) throw new DebateValidationError(`schema:${parsed.error.issues[0]?.path.join(".") || "root"}`);
  const out = parsed.data;
  const evidenceById = new Map(ctx.evidence.map((e) => [e.evidenceId, e]));
  const allowedPct = pctForms(ctx.evidence.map((e) => e.excerpt).join("\n") + "\n" + ctx.question);

  // Every string the model wrote goes through the guards.
  const strings: [string, string][] = [];
  for (const side of SIDES) {
    const c = out[side];
    strings.push([c.thesis, `${side}.thesis`], [c.sufficiencyNote, `${side}.sufficiencyNote`]);
    c.claims.forEach((cl, i) => strings.push([cl.text, `${side}.claims.${i}.text`], [cl.rationale, `${side}.claims.${i}.rationale`]));
    c.assumptions.forEach((a, i) => strings.push([a, `${side}.assumptions.${i}`]));
    c.invalidators.forEach((a, i) => strings.push([a, `${side}.invalidators.${i}`]));
  }
  const r = out.referee;
  strings.push([r.overview, "referee.overview"]);
  for (const x of [...r.unsupportedClaims, ...r.contradictions, ...r.weakEvidence, ...r.sourceBias]) strings.push([x.note, "referee.note"]);
  for (const x of [...r.missingInformation, ...r.wouldChangeAnalysis, ...r.agreement]) strings.push([x, "referee.list"]);
  for (const [t, where] of strings) guardText(t, allowedPct, where);

  // Claims: ids, citations, statuses.
  let hallucinated = 0;
  const claims: DebateClaim[] = [];
  const refToId = new Map<string, string>();
  const sideClaimIds: Record<Side, string[]> = { yes: [], no: [] };
  for (const side of SIDES) {
    out[side].claims.forEach((cl, i) => {
      const claimId = claimIdFor(ctx.debateId, side, i);
      refToId.set(`${side}-${i + 1}`, claimId);
      const flags: string[] = [];
      const refs: string[] = [];
      for (const ref of cl.evidenceIds) {
        if (evidenceById.has(ref)) {
          if (!refs.includes(ref)) refs.push(ref);
        } else {
          hallucinated += 1;
          if (!flags.includes("cited_unknown_evidence")) flags.push("cited_unknown_evidence");
        }
      }
      let status: DebateClaim["status"] = "supported";
      if (refs.length === 0 && (cl.kind === "verified_fact" || cl.kind === "source_supported_interpretation")) {
        status = "unsupported";
        flags.push("no_valid_evidence");
      } else if (flags.length) status = "flagged";
      if (cl.kind === "verified_fact" && refs.length && refs.every((x) => evidenceById.get(x)!.verificationStatus === "user_submitted")) {
        flags.push("fact_rests_on_user_source");
        if (status === "supported") status = "flagged";
      }
      claims.push({ claimId, debateId: ctx.debateId, side, claimText: cl.text, rationale: cl.rationale, evidenceRefs: refs, uncertainty: cl.uncertainty, kind: cl.kind, status, flags });
      sideClaimIds[side].push(claimId);
    });
  }
  if (hallucinated > MAX_HALLUCINATED_REFS) throw new DebateValidationError(`hallucinated_citations:${hallucinated}`);

  const referee = buildReferee(out.referee, refToId, evidenceById, claims, ctx.sourceFailures);
  const yesInsufficient = out.yes.sufficiency === "insufficient" || !claims.some((c) => c.side === "yes" && c.status !== "unsupported");
  const noInsufficient = out.no.sufficiency === "insufficient" || !claims.some((c) => c.side === "no" && c.status !== "unsupported");

  const bundle: DebateBundle = {
    debate: {
      debateId: ctx.debateId,
      roomId: ctx.roomId,
      marketId: ctx.marketId,
      generationVersion: ctx.generationVersion,
      sourceSnapshotId: ctx.sourceSnapshotId,
      status: yesInsufficient && noInsufficient ? "insufficient_evidence" : "ready",
      createdAt: ctx.createdAt,
      expiresAt: ctx.createdAt + DEBATE_TTL_MS,
      lifecycleAtGeneration: ctx.lifecycle,
      marketQuestion: ctx.question.slice(0, 300) || "(no question text)",
      model: ctx.model,
      yes: { thesis: out.yes.thesis, sufficiency: out.yes.sufficiency, sufficiencyNote: out.yes.sufficiencyNote, claimIds: sideClaimIds.yes, assumptions: out.yes.assumptions.filter(Boolean), invalidators: out.yes.invalidators.filter(Boolean) },
      no: { thesis: out.no.thesis, sufficiency: out.no.sufficiency, sufficiencyNote: out.no.sufficiencyNote, claimIds: sideClaimIds.no, assumptions: out.no.assumptions.filter(Boolean), invalidators: out.no.invalidators.filter(Boolean) },
      referee,
      limitations: ctx.limitations.slice(0, 8),
      sourceFailures: ctx.sourceFailures.slice(0, 8),
    },
    claims,
    evidence: ctx.evidence,
  };
  const check = DebateBundleSchema.safeParse(bundle);
  if (!check.success) throw new DebateValidationError(`bundle:${check.error.issues[0]?.message ?? "invalid"}`);
  return check.data;
}

function buildReferee(
  r: ModelDebateOutput["referee"],
  refToId: Map<string, string>,
  evidenceById: Map<string, DebateEvidence>,
  claims: DebateClaim[],
  failures: { url: string; reason: string }[],
): Referee {
  const cap = (s: string, n: number = DEBATE_LIMITS.note) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const unsupported = new Map<string, string>();
  for (const u of r.unsupportedClaims) {
    const id = refToId.get(u.claim);
    if (id && u.note) unsupported.set(id, cap(u.note));
  }
  for (const c of claims) {
    if (unsupported.has(c.claimId)) continue;
    if (c.status === "unsupported") unsupported.set(c.claimId, "Stated as fact or interpretation, but cites no evidence from the set.");
    else if (c.flags.includes("cited_unknown_evidence")) unsupported.set(c.claimId, "Cited a source that isn't in the evidence set; that citation was removed.");
    else if (c.flags.includes("fact_rests_on_user_source")) unsupported.set(c.claimId, "Presented as fact but rests only on a user-submitted source.");
  }
  const contradictions: Referee["contradictions"] = [];
  for (const x of r.contradictions) {
    const ids = [...new Set(x.claims.map((ref) => refToId.get(ref)).filter((v): v is string => Boolean(v)))];
    if (ids.length && x.note) contradictions.push({ claimIds: ids, note: cap(x.note) });
  }
  // Deterministic: the same source cited by both sides is read two ways.
  const bySource = new Map<string, Set<Side>>();
  for (const c of claims) for (const e of c.evidenceRefs) bySource.set(e, (bySource.get(e) ?? new Set()).add(c.side));
  for (const [e, sides] of bySource) {
    if (sides.size < 2) continue;
    const ids = claims.filter((c) => c.evidenceRefs.includes(e)).map((c) => c.claimId).slice(0, 4);
    if (contradictions.some((x) => ids.every((i) => x.claimIds.includes(i)))) continue;
    if (contradictions.length < 8) contradictions.push({ claimIds: ids, note: `Both sides cite the same source (${cap(evidenceById.get(e)!.sourceTitle, 80)}) and read it differently.` });
  }
  const weak = r.weakEvidence.filter((w) => evidenceById.has(w.evidenceId) && w.note).map((w) => ({ evidenceId: w.evidenceId, note: cap(w.note) }));
  for (const e of evidenceById.values()) {
    if (weak.length >= 8) break;
    if (e.note && /truncated/i.test(e.note) && !weak.some((w) => w.evidenceId === e.evidenceId)) weak.push({ evidenceId: e.evidenceId, note: "Only part of this source could be read (size limit), so it may be incomplete." });
  }
  const missing = r.missingInformation.filter(Boolean).map((s) => cap(s, DEBATE_LIMITS.listItem));
  for (const f of failures) {
    if (missing.length >= 8) break;
    missing.push(cap(`A declared source couldn't be read (${f.reason}), so it isn't part of this analysis.`, DEBATE_LIMITS.listItem));
  }
  return {
    overview: r.overview,
    evidenceQuality: r.evidenceQuality,
    unsupportedClaims: [...unsupported].slice(0, 12).map(([claimId, note]) => ({ claimId, note })),
    contradictions: contradictions.slice(0, 8),
    weakEvidence: weak.slice(0, 8),
    missingInformation: missing.slice(0, 8),
    sourceBias: r.sourceBias.filter((b) => b.note && (b.evidenceId === null || evidenceById.has(b.evidenceId))).map((b) => ({ evidenceId: b.evidenceId, note: cap(b.note) })).slice(0, 6),
    wouldChangeAnalysis: r.wouldChangeAnalysis.filter(Boolean).slice(0, 6),
    agreement: r.agreement.filter(Boolean).slice(0, 5),
  };
}

// ------------------------------------------------------------------ challenge

export function buildChallengeResponse(raw: unknown, allowed: DebateEvidence[], question: string): { verdict: ChallengeVerdict; text: string; evidenceRefs: string[]; coerced: boolean } {
  const parsed = ModelChallengeOutput.safeParse(parseJson(raw));
  if (!parsed.success) throw new DebateValidationError(`schema:${parsed.error.issues[0]?.path.join(".") || "root"}`);
  const { verdict, text, evidenceIds } = parsed.data;
  guardText(text, pctForms(allowed.map((e) => e.excerpt).join("\n") + "\n" + question), "challenge.text");
  const ids = new Set(allowed.map((e) => e.evidenceId));
  const refs = [...new Set(evidenceIds)].filter((x) => ids.has(x));
  const invented = evidenceIds.filter((x) => !ids.has(x)).length;
  if (invented > MAX_HALLUCINATED_REFS) throw new DebateValidationError(`hallucinated_citations:${invented}`);
  // A verdict must rest on evidence; otherwise it's "insufficient".
  if (verdict !== "insufficient_evidence" && refs.length === 0) return { verdict: "insufficient_evidence", text, evidenceRefs: [], coerced: true };
  return { verdict, text, evidenceRefs: refs, coerced: false };
}
