/**
 * Create Market state machine (pure, deterministic).
 *
 * Main path:
 *   DEFINE → QUOTED → BUILT → VALIDATED → SIMULATED → REVIEW
 *     → WALLET_APPROVAL → BROADCAST → CONFIRMATION → CONFIRMED_ON_CHAIN
 *     → REGISTER → SUCCESS
 * Registration recovery:
 *   CONFIRMED_ON_CHAIN / REGISTER → REGISTRATION_NEEDS_ATTENTION
 *     → RETRY_REGISTER → SUCCESS (or back to NEEDS_ATTENTION)
 *
 * Invariant: once a signed transaction may have been sent (BROADCAST and
 * every later phase), no transition leads back into quote / build / sign.
 * The only exits are proofs that it can never land or never moved funds
 * (CHAIN_FAILED: landed with an error, atomic so no USDC moved; EXPIRED:
 * blockhash expired with no status and no event account), or SUCCESS.
 */

export const CREATE_PHASES = [
  "DEFINE",
  "QUOTED",
  "BUILT",
  "VALIDATED",
  "SIMULATED",
  "REVIEW",
  "BLOCKED",
  "WALLET_APPROVAL",
  "WALLET_REJECTED",
  "BROADCAST",
  "CONFIRMATION",
  "CONFIRMATION_UNCERTAIN",
  "CONFIRMED_ON_CHAIN",
  "CHAIN_FAILED",
  "EXPIRED",
  "REGISTER",
  "REGISTRATION_NEEDS_ATTENTION",
  "RETRY_REGISTER",
  "SUCCESS",
] as const;
export type CreatePhase = (typeof CREATE_PHASES)[number];

/** Phases in which a signed transaction may already be on its way to the chain. */
export const MAY_BE_BROADCAST: ReadonlySet<CreatePhase> = new Set<CreatePhase>([
  "BROADCAST",
  "CONFIRMATION",
  "CONFIRMATION_UNCERTAIN",
  "CONFIRMED_ON_CHAIN",
  "REGISTER",
  "REGISTRATION_NEEDS_ATTENTION",
  "RETRY_REGISTER",
  "SUCCESS",
]);

/** Phases that touch quote / build / simulation / signing. Never reachable from MAY_BE_BROADCAST. */
export const PRE_SIGN: ReadonlySet<CreatePhase> = new Set<CreatePhase>(["DEFINE", "QUOTED", "BUILT", "VALIDATED", "SIMULATED", "REVIEW", "BLOCKED", "WALLET_APPROVAL", "WALLET_REJECTED"]);

const T: Record<CreatePhase, readonly CreatePhase[]> = {
  DEFINE: ["QUOTED"],
  QUOTED: ["BUILT", "BLOCKED", "DEFINE"],
  BUILT: ["VALIDATED", "BLOCKED", "DEFINE"],
  VALIDATED: ["SIMULATED", "BLOCKED", "DEFINE"],
  SIMULATED: ["REVIEW", "BLOCKED", "DEFINE"],
  // Rebuild goes back through BUILT → VALIDATED → SIMULATED; nothing skips a check.
  REVIEW: ["WALLET_APPROVAL", "BLOCKED", "BUILT", "DEFINE"],
  BLOCKED: ["DEFINE", "QUOTED", "BUILT"],
  // Wallet signs → BROADCAST; rejection or a changed signed message never broadcasts.
  WALLET_APPROVAL: ["BROADCAST", "WALLET_REJECTED", "BLOCKED"],
  WALLET_REJECTED: ["BUILT", "DEFINE"],
  BROADCAST: ["CONFIRMATION", "CONFIRMATION_UNCERTAIN"],
  CONFIRMATION: ["CONFIRMED_ON_CHAIN", "CHAIN_FAILED", "EXPIRED", "CONFIRMATION_UNCERTAIN"],
  CONFIRMATION_UNCERTAIN: ["CONFIRMED_ON_CHAIN", "CHAIN_FAILED", "EXPIRED", "CONFIRMATION_UNCERTAIN"],
  CONFIRMED_ON_CHAIN: ["REGISTER", "REGISTRATION_NEEDS_ATTENTION"],
  REGISTER: ["SUCCESS", "REGISTRATION_NEEDS_ATTENTION"],
  REGISTRATION_NEEDS_ATTENTION: ["RETRY_REGISTER"],
  RETRY_REGISTER: ["SUCCESS", "REGISTRATION_NEEDS_ATTENTION"],
  // Proven terminal: may start a brand-new creation (new quote).
  CHAIN_FAILED: ["DEFINE"],
  EXPIRED: ["DEFINE"],
  SUCCESS: ["DEFINE"],
};

export function canTransition(from: CreatePhase, to: CreatePhase): boolean {
  return T[from].includes(to);
}

export class IllegalTransition extends Error {
  constructor(
    public from: CreatePhase,
    public to: CreatePhase,
  ) {
    super(`Create flow cannot go from ${from} to ${to}.`);
  }
}

/** Deterministic transition: returns `to` or throws. */
export function transition(from: CreatePhase, to: CreatePhase): CreatePhase {
  if (!canTransition(from, to)) throw new IllegalTransition(from, to);
  return to;
}

export const CREATE_TRANSITIONS: Readonly<Record<CreatePhase, readonly CreatePhase[]>> = T;

/** Phase to resume in after a refresh, from the durable recovery record. Never a pre-sign phase. */
export function phaseForRecoveryStage(stage: "signed" | "broadcast" | "confirmed" | "registration_needs_attention"): CreatePhase {
  if (stage === "signed" || stage === "broadcast") return "CONFIRMATION_UNCERTAIN";
  return "REGISTRATION_NEEDS_ATTENTION";
}
