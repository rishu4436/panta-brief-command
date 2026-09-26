import type { BriefMode } from "./types";

/** Analytical brief modes (shared by client tabs and server validation). */
export const BRIEF_MODES: readonly { id: BriefMode; label: string; hint: string }[] = [
  { id: "desk", label: "Desk read", hint: "Probability, flow, timing and quality together" },
  { id: "flow", label: "Flow", hint: "Prints, share split, imbalance, concentration" },
  { id: "risk", label: "Risk", hint: "Every flag and data-quality reason" },
  { id: "catalysts", label: "Catalysts", hint: "Catalog description + resolution time only" },
];

export const BRIEF_MODE_IDS = BRIEF_MODES.map((m) => m.id) as readonly BriefMode[];

export function isBriefMode(v: unknown): v is BriefMode {
  return typeof v === "string" && (BRIEF_MODE_IDS as readonly string[]).includes(v);
}

/**
 * /api/brief requests per IP per minute. 20 lets a judge click through all
 * four modes and regenerate; the 60s server cache still prevents re-billing.
 */
export const BRIEF_RATE_LIMIT = 20;
