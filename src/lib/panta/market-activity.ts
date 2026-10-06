/**
 * One normalized "your activity on this market" row (Stage D).
 *
 * Sources, merged by signature, for one market + one wallet:
 *  - tape:    Panta's market tape (GET /markets/{id}/trades/): an on-chain trade
 *             Panta indexed. The only source of authoritative shares.
 *  - ledger:  GET /account/trades/ (attribution to this app; status).
 *  - session: this tab's confirmed trade (trade-session.ts): Solana
 *             confirmation + Panta /primaryorderverify/ result.
 *
 * "verified" only when Panta's order verification returned success for this
 * signature AND no tape / ledger row contradicts the market, side or wallet
 * the signed transaction committed to. Plain confirmation is never verified.
 */

import type { AccountTrade, Side, Trade } from "./domain";
import type { SessionTrade } from "@/lib/data/trade-session";

export type ActivityTx = "confirmed" | "indexed";
export type ActivityVerification = "verified" | "verifying" | "verify_slow" | "verify_failed" | "mismatch" | "not_checked";
export type ActivityAttribution = "attributed" | "reported" | "not_listed" | "unknown";

export type MarketActivityItem = {
  signature: string;
  marketId: string;
  side: Side | null;
  /** USDC paid (tape or ledger, else the signed amount). */
  amountUsdc: number | null;
  /** Authoritative shares (tape) only; null until Panta indexes the trade. */
  shares: number | null;
  /** ms epoch: tape blockTime, else ledger createdAt, else session confirmation. */
  timeMs: number | null;
  /** "indexed" = in Panta's tape; "confirmed" = Solana-confirmed this session, not indexed yet. */
  tx: ActivityTx;
  verification: ActivityVerification;
  attribution: ActivityAttribution;
  ledgerStatus: string | null;
  sources: { tape: boolean; ledger: boolean; session: boolean };
  /** What the signed transaction committed to (session only). */
  expected: { marketId: string; side: "yes" | "no"; amountUsdc: number; wallet: string } | null;
  mismatchReason: string | null;
};

/** Same success set as the ticket's /primaryorderverify/ poll (PrimaryBuyPanel VERIFY_SUCCESS). */
const VERIFY_SUCCESS = new Set(["confirmed"]);

function mismatch(
  s: SessionTrade,
  tape: Trade | undefined,
  ledger: AccountTrade | undefined,
): string | null {
  if (tape) {
    if (tape.marketId && tape.marketId !== s.marketId) return "Panta's tape lists this signature on a different market.";
    if (tape.wallet && tape.wallet !== s.wallet) return "Panta's tape lists this signature for a different wallet.";
    if (tape.side && tape.side !== s.side) return "Panta's tape lists a different side for this signature.";
  }
  if (ledger) {
    if (ledger.marketId && ledger.marketId !== s.marketId) return "The attribution ledger lists this signature on a different market.";
    if (ledger.wallet && ledger.wallet !== s.wallet) return "The attribution ledger lists this signature for a different wallet.";
    if (ledger.side && ledger.side !== s.side) return "The attribution ledger lists a different side for this signature.";
  }
  return null;
}

function verificationOf(s: SessionTrade | undefined, mm: string | null): ActivityVerification {
  if (!s) return "not_checked";
  if (mm) return "mismatch";
  switch (s.verify) {
    case "confirmed":
      return s.verifyStatus && VERIFY_SUCCESS.has(s.verifyStatus) ? "verified" : "not_checked";
    case "polling":
      return "verifying";
    case "timeout":
      return "verify_slow";
    case "failed":
      return "verify_failed";
    default:
      return "not_checked";
  }
}

export function buildMarketActivity(input: {
  marketId: string;
  wallet: string | null;
  tape: Trade[] | null | undefined;
  /** Full ledger page (filtered here; used to detect contradictions by signature). */
  ledger: AccountTrade[] | null | undefined;
  session: SessionTrade[];
}): MarketActivityItem[] {
  const { marketId, wallet } = input;
  if (!wallet) return [];
  const tapeBySig = new Map<string, Trade>();
  for (const t of input.tape ?? []) if (t.signature) tapeBySig.set(t.signature, t);
  const ledgerBySig = new Map<string, AccountTrade>();
  for (const l of input.ledger ?? []) if (l.signature) ledgerBySig.set(l.signature, l);
  const sessionBySig = new Map<string, SessionTrade>();
  for (const s of input.session) if (s.marketId === marketId && s.wallet === wallet) sessionBySig.set(s.signature, s);

  const sigs = new Set<string>(sessionBySig.keys());
  for (const [sig, t] of tapeBySig) if (t.wallet === wallet && (!t.marketId || t.marketId === marketId)) sigs.add(sig);
  for (const [sig, l] of ledgerBySig) if (l.wallet === wallet && l.marketId === marketId && (l.kind ?? "buy") === "buy") sigs.add(sig);

  const out: MarketActivityItem[] = [];
  for (const sig of sigs) {
    const s = sessionBySig.get(sig);
    const tape = tapeBySig.get(sig);
    const ledger = ledgerBySig.get(sig);
    const mm = s ? mismatch(s, tape, ledger) : null;
    const signedUsdc = s ? Number(s.amountBase) / 1e6 : null;
    const ledgerTime = ledger?.createdAt ? Date.parse(ledger.createdAt) : NaN;
    out.push({
      signature: sig,
      marketId,
      side: tape?.side ?? ledger?.side ?? s?.side ?? null,
      amountUsdc: tape?.amountUsdc ?? ledger?.amountUsdc ?? (signedUsdc != null && Number.isFinite(signedUsdc) ? signedUsdc : null),
      shares: tape?.shares ?? null,
      timeMs: tape?.blockTime ? tape.blockTime * 1000 : Number.isFinite(ledgerTime) ? ledgerTime : (s?.confirmedAt ?? null),
      tx: tape ? "indexed" : "confirmed",
      verification: verificationOf(s, mm),
      attribution: ledger
        ? String(ledger.status || "").toLowerCase() === "processed"
          ? "attributed"
          : "reported"
        : input.ledger
          ? "not_listed"
          : "unknown",
      ledgerStatus: ledger?.status ?? null,
      sources: { tape: Boolean(tape), ledger: Boolean(ledger), session: Boolean(s) },
      expected: s && signedUsdc != null ? { marketId: s.marketId, side: s.side, amountUsdc: signedUsdc, wallet: s.wallet } : null,
      mismatchReason: mm,
    });
  }
  return out.sort((a, b) => (b.timeMs ?? 0) - (a.timeMs ?? 0));
}

export const VERIFICATION_LABEL: Record<ActivityVerification, string> = {
  verified: "Verified by Panta",
  verifying: "Verifying with Panta…",
  verify_slow: "Verification pending",
  verify_failed: "Verification failed",
  mismatch: "Mismatch: not verified",
  not_checked: "Not verified in this session",
};

export const TX_LABEL: Record<ActivityTx, string> = {
  indexed: "Confirmed · indexed by Panta",
  confirmed: "Confirmed on Solana · awaiting Panta index",
};

export const ATTRIBUTION_LABEL: Record<ActivityAttribution, string> = {
  attributed: "Attributed",
  reported: "Reported",
  not_listed: "Not in ledger",
  unknown: "Ledger unavailable",
};
