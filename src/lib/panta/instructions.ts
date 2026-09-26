/**
 * Pre-sign validation for Panta-built instruction lists.
 *
 * Panta returns unsigned instructions; we compile and ask the wallet to sign.
 * The upstream is not blindly trusted: every program must be on this
 * allowlist, the only signer may be the connected wallet, and the compiled fee
 * payer must be that wallet. Anything else blocks signing.
 */

import { Buffer } from "buffer";
import { PublicKey, type VersionedTransaction } from "@solana/web3.js";
import type { BuiltInstruction } from "@/lib/types";

/**
 * Panta USDC markets program (instructions `primary_order_usdc`,
 * `claim_win_usdc`, `claim_creator_fees_usdc`).
 *
 * Source: not printed in docs.panta.market or the Kaito-HQ/panta-api-playground
 * repo (both show `"programId": "…"`). Taken from mainnet: the signatures
 * returned by live GET /markets/{id}/trades/ (e.g. 5m9TBr5L…, 5VrsQMpz…)
 * invoke exactly this program with log "Instruction: PrimaryOrderUsdc".
 * Docs (trades/report) state reported txs "must invoke the USDC program".
 * If Panta migrates programs, signing is blocked until this list is updated.
 */
export const PANTA_USDC_PROGRAM_ID = "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp";

export const PROGRAM_LABELS: Record<string, string> = {
  [PANTA_USDC_PROGRAM_ID]: "Panta USDC",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  "11111111111111111111111111111111": "System",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token",
  // Docs (orders/overview): "When present [userId], build may include an SPL Memo instruction."
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo",
  Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo: "Memo (v1)",
};

export const ALLOWED_PROGRAM_IDS = new Set(Object.keys(PROGRAM_LABELS));

/** A Panta build is one Panta ix plus a few helpers (compute budget, ATA, memo). */
export const MAX_INSTRUCTIONS = 10;
const MAX_ACCOUNTS_PER_IX = 64;
/** Solana packet limit; no single ix payload can exceed it. */
const MAX_IX_DATA_BYTES = 1232;

export type InstructionCheck =
  | { ok: true; count: number; programs: string[] }
  | { ok: false; reason: string };

function toKey(v: unknown): PublicKey | null {
  if (typeof v !== "string" || v.length < 32 || v.length > 44) return null;
  try {
    return new PublicKey(v);
  } catch {
    return null;
  }
}

export function programLabel(id: string): string {
  return PROGRAM_LABELS[id] || `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function validatePantaInstructions(
  instructions: unknown,
  wallet: PublicKey,
): InstructionCheck {
  if (!Array.isArray(instructions) || instructions.length === 0) {
    return { ok: false, reason: "Build returned no instructions." };
  }
  if (instructions.length > MAX_INSTRUCTIONS) {
    return {
      ok: false,
      reason: `Build returned ${instructions.length} instructions (max ${MAX_INSTRUCTIONS}). Signing blocked.`,
    };
  }
  const programs: string[] = [];
  let hasPanta = false;

  for (const [i, raw] of instructions.entries()) {
    const ix = raw as Partial<BuiltInstruction>;
    const program = toKey(ix?.programId);
    if (!program) {
      return { ok: false, reason: `Instruction ${i + 1} has an invalid programId. Signing blocked.` };
    }
    const pid = program.toBase58();
    if (!ALLOWED_PROGRAM_IDS.has(pid)) {
      return {
        ok: false,
        reason: `Instruction ${i + 1} calls an unexpected program (${pid}). Signing blocked — this transaction does not match the known Panta shape.`,
      };
    }
    if (pid === PANTA_USDC_PROGRAM_ID) hasPanta = true;
    if (!programs.includes(pid)) programs.push(pid);

    if (!Array.isArray(ix.accounts) || ix.accounts.length > MAX_ACCOUNTS_PER_IX) {
      return { ok: false, reason: `Instruction ${i + 1} has a malformed account list. Signing blocked.` };
    }
    for (const acc of ix.accounts) {
      const key = toKey(acc?.pubkey);
      if (!key) {
        return { ok: false, reason: `Instruction ${i + 1} has an invalid account key. Signing blocked.` };
      }
      if (acc.isSigner && !key.equals(wallet)) {
        return {
          ok: false,
          reason: `Instruction ${i + 1} requires an extra signer (${key.toBase58()}). Only your wallet may sign. Signing blocked.`,
        };
      }
    }
    if (typeof ix.data !== "string" || Buffer.from(ix.data, "base64").byteLength > MAX_IX_DATA_BYTES) {
      return { ok: false, reason: `Instruction ${i + 1} has malformed data. Signing blocked.` };
    }
  }

  if (!hasPanta) {
    return { ok: false, reason: "Build does not invoke the Panta USDC program. Signing blocked." };
  }
  return { ok: true, count: instructions.length, programs };
}

/** Compiled message fee payer (static account 0) must be the connected wallet. */
export function assertFeePayer(tx: VersionedTransaction, wallet: PublicKey): void {
  const payer = tx.message.staticAccountKeys[0];
  if (!payer || !payer.equals(wallet)) {
    throw new Error("Fee payer is not the connected wallet. Signing blocked.");
  }
}
