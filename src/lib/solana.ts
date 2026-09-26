"use client";

import { Buffer } from "buffer";
import {
  type Connection,
  PublicKey,
  TransactionExpiredBlockheightExceededError,
  TransactionExpiredTimeoutError,
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

export async function confirmSignature(
  connection: Connection,
  signature: string,
  blockhash: string,
  lastValidBlockHeight: number,
): Promise<ConfirmOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      ),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), CONFIRM_HARD_TIMEOUT_MS);
      }),
    ]);
    if (res === "timeout") {
      return {
        status: "pending",
        message: "No confirmation after 90s. The transaction may still land — check again before retrying.",
      };
    }
    if (res.value.err) {
      return {
        status: "failed",
        message: `Transaction failed on-chain: ${JSON.stringify(res.value.err).slice(0, 200)}`,
      };
    }
    return { status: "confirmed" };
  } catch (e) {
    if (e instanceof TransactionExpiredBlockheightExceededError) {
      return {
        status: "expired",
        message: "Blockhash expired before the transaction confirmed. It can no longer land and no funds moved — re-quote and try again.",
      };
    }
    if (e instanceof TransactionExpiredTimeoutError) {
      return {
        status: "pending",
        message: "Confirmation timed out. The transaction may still land — check again before retrying.",
      };
    }
    return {
      status: "pending",
      message: `Could not confirm (RPC error: ${errText(e).slice(0, 160)}). Check again before retrying.`,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
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
