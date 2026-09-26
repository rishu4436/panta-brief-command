/**
 * Claims adapter: POST /claim/build/ (win) and /claim/creator-fees/build/
 * → ClaimBuild. Write path: parsed strictly before anything is signed.
 */

import { z } from "zod";
import { InstructionSchema, numish, optNum, optStr, pantaFetch, parseOrThrow } from "./client";
import type { ClaimBuild, ClaimKind } from "./domain";

const RawClaimSchema = z.looseObject({
  wallet: optStr,
  marketId: optStr,
  outcome: optStr,
  winningShares: numish,
  claimableFeesUsdc: numish,
  instructions: z.array(InstructionSchema),
  recentBlockhash: z.string().min(32),
  lastValidBlockHeight: optNum,
});

export const CLAIM_PATHS: Record<ClaimKind, string> = {
  win: "/claim/build/",
  "creator-fees": "/claim/creator-fees/build/",
};

/**
 * Only win claims can be reported for attribution. Panta docs (trades/report):
 * reported txs must be a primary buy or win claim; creator-fee claims return
 * TX_MISMATCH, so the desk never reports them.
 */
export function isAttributableClaim(kind: ClaimKind): boolean {
  return kind === "win";
}

export function parseClaimBuild(kind: ClaimKind, raw: unknown): ClaimBuild {
  const c = parseOrThrow(RawClaimSchema, raw, `${kind} claim build`);
  return {
    kind,
    wallet: c.wallet || "",
    marketId: c.marketId || "",
    instructions: c.instructions,
    recentBlockhash: c.recentBlockhash,
    lastValidBlockHeight: c.lastValidBlockHeight ?? undefined,
    outcome: c.outcome ?? undefined,
    winningShares: c.winningShares == null ? undefined : String(c.winningShares),
    claimableFeesUsdc: c.claimableFeesUsdc == null ? undefined : String(c.claimableFeesUsdc),
  };
}

export async function buildClaim(
  kind: ClaimKind,
  input: { wallet: string; marketId: string },
): Promise<ClaimBuild> {
  const { data } = await pantaFetch(CLAIM_PATHS[kind], { method: "POST", body: input });
  return parseClaimBuild(kind, data);
}
