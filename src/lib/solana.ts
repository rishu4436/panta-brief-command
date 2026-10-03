"use client";

import { Buffer } from "buffer";
import {
  type Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { BuiltInstruction } from "./panta/domain";

if (
  typeof window !== "undefined" &&
  !(window as unknown as { Buffer?: typeof Buffer }).Buffer
) {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

export function instructionsToVersionedTx(
  instructions: BuiltInstruction[],
  feePayer: PublicKey,
  recentBlockhash: string,
): VersionedTransaction {
  const ixs = instructions.map(
    (ix) =>
      new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.accounts.map((a) => ({
          pubkey: new PublicKey(a.pubkey),
          isSigner: a.isSigner,
          isWritable: a.isWritable,
        })),
        data: Buffer.from(ix.data, "base64") as unknown as Buffer,
      }),
  );
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash,
    instructions: ixs,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

// ---------------------------------------------------------------------------
// Confirmation: sendRawTransaction only returns a signature. Panta submit must
// wait for the tx to actually land at `confirmed`.
// ---------------------------------------------------------------------------

export type ConfirmOutcome =
  | { status: "confirmed" }
  | { status: "failed"; message: string }
  | { status: "expired"; message: string }
  | { status: "pending"; message: string };

/** Hard ceiling on waiting for confirmation (blockhash validity is ~60–90s). */
const CONFIRM_HARD_TIMEOUT_MS = 90_000;

/**
 * lastValidBlockHeight for the blockhash we will sign with. Panta build
 * responses usually include it; otherwise fall back to the RPC's latest
 * blockhash info (an upper bound when the blockhash differs, so the wait
 * ends slightly later than strictly necessary — never earlier).
 */
export async function resolveLastValidBlockHeight(
  connection: Connection,
  fromBuild?: number | null,
): Promise<number> {
  if (typeof fromBuild === "number" && Number.isFinite(fromBuild) && fromBuild > 0) {
    return fromBuild;
  }
  const latest = await connection.getLatestBlockhash("confirmed");
  return latest.lastValidBlockHeight;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Poll cadence for confirmation (HTTP only — the relay has no websocket). */
export const CONFIRM_POLL_MS = 2_000;
/** Block height is checked every Nth poll (it only matters near expiry). */
const HEIGHT_EVERY = 3;

type ConfirmDeps = { now?: () => number; sleep?: (ms: number) => Promise<void>; pollMs?: number; hardTimeoutMs?: number };
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wait for `signature` to reach `confirmed`, by HTTP polling of
 * getSignatureStatuses (+ getBlockHeight for blockhash expiry). Same outcomes
 * and limits as web3.js confirmTransaction with the block-height strategy,
 * which needed a websocket subscription the /api/rpc relay can't provide:
 *  - status err → failed; confirmed/finalized → confirmed;
 *  - block height > lastValidBlockHeight (re-checked once more) → expired;
 *  - 90 s hard ceiling → pending ("may still land");
 *  - RPC errors are retried until the ceiling, then reported as pending.
 * `blockhash` is kept in the signature for callers; expiry uses the height.
 */
export async function confirmSignature(
  connection: Connection,
  signature: string,
  _blockhash: string,
  lastValidBlockHeight: number,
  deps: ConfirmDeps = {},
): Promise<ConfirmOutcome> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const pollMs = deps.pollMs ?? CONFIRM_POLL_MS;
  const deadline = now() + (deps.hardTimeoutMs ?? CONFIRM_HARD_TIMEOUT_MS);
  let lastError: string | null = null;

  const status = async (): Promise<ConfirmOutcome | null> => {
    const { value } = await connection.getSignatureStatuses([signature]);
    const st = value[0];
    if (st?.err) {
      return { status: "failed", message: `Transaction failed on-chain: ${JSON.stringify(st.err).slice(0, 200)}` };
    }
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
      return { status: "confirmed" };
    }
    return null;
  };

  for (let i = 0; now() < deadline; i++) {
    try {
      const s = await status();
      if (s) return s;
      if (i % HEIGHT_EVERY === HEIGHT_EVERY - 1 || i === 0) {
        const height = await connection.getBlockHeight("confirmed");
        if (height > lastValidBlockHeight) {
          const last = await status();
          if (last) return last;
          return {
            status: "expired",
            message: "Blockhash expired before the transaction confirmed. It can no longer land and no funds moved — re-quote and try again.",
          };
        }
      }
      lastError = null;
    } catch (e) {
      lastError = errText(e);
    }
    if (now() + pollMs >= deadline) break;
    await sleep(pollMs);
  }
  if (lastError) {
    return {
      status: "pending",
      message: `Could not confirm (RPC error: ${lastError.slice(0, 160)}). Check again before retrying.`,
    };
  }
  return {
    status: "pending",
    message: "No confirmation after 90s. The transaction may still land — check again before retrying.",
  };
}

/** One-shot status check used by the "Check again" retry path. */
export async function checkSignatureOnce(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number | null,
): Promise<ConfirmOutcome> {
  try {
    const { value } = await connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });
    if (value?.err) {
      return {
        status: "failed",
        message: `Transaction failed on-chain: ${JSON.stringify(value.err).slice(0, 200)}`,
      };
    }
    if (value && (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized")) {
      return { status: "confirmed" };
    }
    if (lastValidBlockHeight != null) {
      const height = await connection.getBlockHeight("confirmed");
      if (height > lastValidBlockHeight) {
        return {
          status: "expired",
          message: "Blockhash expired and the transaction never confirmed. No funds moved — re-quote and try again.",
        };
      }
    }
    return { status: "pending", message: "Not confirmed yet. Wait a few seconds and check again." };
  } catch (e) {
    return { status: "pending", message: `RPC error while checking: ${errText(e).slice(0, 160)}` };
  }
}
