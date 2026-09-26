import { describe, expect, it } from "vitest";
import {
  QUOTE_EXPIRY_MARGIN_MS,
  QUOTE_FALLBACK_TTL_MS,
  STEP_ORDER,
  TRADE_STATES,
  classifyFailure,
  deriveTradeState,
  formatClock,
  isUserRejection,
  quoteDeadline,
  secondsLeft,
  stepMarksFor,
  type TradeSnapshot,
  type TradeStateId,
} from "@/lib/trade-state";

/** Mimics @solana/wallet-adapter-base: message + original error on `.error`. */
class WalletSignTransactionError extends Error {
  error: unknown;
  constructor(message?: string, error?: unknown) {
    super(message);
    this.name = "WalletSignTransactionError";
    this.error = error;
  }
}

const base: TradeSnapshot = {
  connected: true,
  closed: null,
  running: null,
  failure: null,
  hasQuote: false,
  quoteExpired: false,
  quoteStale: false,
  hasBuild: false,
  presignOk: false,
  reviewOpen: false,
  hasSignature: false,
  txPhase: "idle",
  verifyPhase: "idle",
  attrPhase: "idle",
};
const d = (p: Partial<TradeSnapshot>) => deriveTradeState({ ...base, ...p });

describe("isUserRejection", () => {
  it("detects the adapter wrapper with an EIP-1193 4001 inner error", () => {
    expect(isUserRejection(new WalletSignTransactionError("", { code: 4001, message: "x" }))).toBe(true);
  });
  it("detects common wallet rejection messages", () => {
    for (const m of ["User rejected the request.", "Transaction rejected by user", "Approval Denied", "User declined", "The user cancelled the request"]) {
      expect(isUserRejection(new Error(m)), m).toBe(true);
    }
    expect(isUserRejection(new WalletSignTransactionError("User rejected the request."))).toBe(true);
  });
  it("detects a top-level code and a cause chain", () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection(new Error("wrapped", { cause: new Error("User rejected the request") }))).toBe(true);
  });
  it("does not treat other signing errors as rejection", () => {
    expect(isUserRejection(new WalletSignTransactionError("Ledger device locked"))).toBe(false);
    expect(isUserRejection(new Error("failed to fetch"))).toBe(false);
    expect(isUserRejection({ code: -32603, message: "Internal error" })).toBe(false);
    expect(isUserRejection(null)).toBe(false);
  });
});

describe("classifyFailure", () => {
  it("maps each stage to its failure state", () => {
    expect(classifyFailure("quote", new Error("x"))).toBe("quote_failed");
    expect(classifyFailure("build", new Error("x"))).toBe("build_failed");
    expect(classifyFailure("build", new Error("x"), { presign: true })).toBe("presign_failed");
    expect(classifyFailure("sign", new Error("User rejected the request."))).toBe("signature_rejected");
    expect(classifyFailure("sign", new WalletSignTransactionError("Device locked"))).toBe("sign_failed");
    expect(classifyFailure("sign", new Error("x"), { presign: true })).toBe("presign_failed");
    expect(classifyFailure("broadcast", new Error("Transaction simulation failed"))).toBe("broadcast_failed");
    expect(classifyFailure("confirm", new Error("x"))).toBe("confirm_timeout");
    expect(classifyFailure("submit", new Error("x"))).toBe("submit_failed");
    expect(classifyFailure("verify", new Error("x"))).toBe("verify_failed");
    expect(classifyFailure("attribute", new Error("x"))).toBe("submit_failed");
  });
});

describe("quote expiry", () => {
  it("uses Panta expiresAt when parseable", () => {
    const r = quoteDeadline("2026-09-26T10:00:30.000Z", Date.parse("2026-09-26T10:00:00Z"));
    expect(r).toEqual({ deadlineMs: Date.parse("2026-09-26T10:00:30.000Z") - QUOTE_EXPIRY_MARGIN_MS, source: "panta" });
  });
  it("falls back to a conservative TTL", () => {
    expect(quoteDeadline("", 1000)).toEqual({ deadlineMs: 1000 + QUOTE_FALLBACK_TTL_MS, source: "fallback" });
    expect(quoteDeadline("not a date", 5).source).toBe("fallback");
    // Shorter than Panta's documented ~90 s session.
    expect(QUOTE_FALLBACK_TTL_MS).toBeLessThan(90_000);
  });
  it("counts down and formats", () => {
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 10_000)).toBe(0);
    expect(secondsLeft(10_000, 99_000)).toBe(0);
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(0)).toBe("0:00");
  });
});

describe("deriveTradeState", () => {
  it("covers the pre-trade states", () => {
    expect(d({ connected: false })).toBe("disconnected");
    expect(d({})).toBe("ready");
    expect(d({ running: "quote" })).toBe("quoting");
    expect(d({ hasQuote: true })).toBe("quote_ready");
    expect(d({ hasQuote: true, quoteStale: true })).toBe("quote_stale");
    expect(d({ hasQuote: true, quoteExpired: true })).toBe("quote_expired");
    expect(d({ hasQuote: true, hasBuild: true, presignOk: true, reviewOpen: true })).toBe("review");
    expect(d({ hasQuote: true, reviewOpen: true, quoteExpired: true })).toBe("quote_expired");
  });
  it("keeps the ticket readable but asks to connect when disconnected", () => {
    expect(d({ connected: false, hasQuote: true })).toBe("disconnected");
  });
  it("separates a declined signature from a signing error", () => {
    const q = { hasQuote: true, hasBuild: true, presignOk: true };
    expect(d({ ...q, running: "sign" })).toBe("awaiting_signature");
    expect(d({ ...q, failure: classifyFailure("sign", { code: 4001 }) })).toBe("signature_rejected");
    expect(d({ ...q, failure: classifyFailure("sign", new Error("boom")) })).toBe("sign_failed");
    // Once the quote runs out, retrying the signature is not offered.
    expect(d({ ...q, failure: "signature_rejected", quoteExpired: true })).toBe("quote_expired");
  });
  it("tracks the on-chain and Panta lifecycle without skipping ahead", () => {
    const sent = { hasQuote: true, hasBuild: true, presignOk: true, hasSignature: true };
    expect(d({ ...sent, running: "confirm", txPhase: "confirming" })).toBe("confirming");
    expect(d({ ...sent, txPhase: "pending", failure: "confirm_timeout" })).toBe("confirm_timeout");
    expect(d({ ...sent, txPhase: "expired", failure: "confirm_timeout" })).toBe("tx_failed");
    expect(d({ ...sent, txPhase: "failed" })).toBe("tx_failed");
    expect(d({ ...sent, txPhase: "confirmed" })).toBe("confirmed");
    expect(d({ ...sent, txPhase: "confirmed", running: "verify", verifyPhase: "polling" })).toBe("verifying");
    expect(d({ ...sent, txPhase: "confirmed", verifyPhase: "timeout", attrPhase: "reported" })).toBe("verify_slow");
    expect(d({ ...sent, txPhase: "confirmed", verifyPhase: "confirmed", attrPhase: "reported" })).toBe("verified");
    expect(d({ ...sent, txPhase: "confirmed", attrPhase: "reported" })).toBe("reported");
    expect(d({ ...sent, txPhase: "confirmed", verifyPhase: "timeout", attrPhase: "attributed" })).toBe("attributed");
    expect(d({ ...sent, txPhase: "confirmed", failure: "submit_failed" })).toBe("submit_failed");
  });
  it("never reports verified or attributed without the matching Panta result", () => {
    const sent = { hasQuote: true, hasBuild: true, presignOk: true, hasSignature: true, txPhase: "confirmed" as const };
    for (const v of ["idle", "polling", "timeout", "failed"] as const) {
      for (const a of ["idle", "reporting", "reported"] as const) {
        const s = d({ ...sent, verifyPhase: v, attrPhase: a });
        expect(s).not.toBe("verified");
        expect(s).not.toBe("attributed");
      }
    }
  });
  it("keeps tracking a sent transaction if the wallet disconnects", () => {
    expect(d({ connected: false, hasSignature: true, txPhase: "confirmed", verifyPhase: "polling" })).toBe("verifying");
  });
  it("closed markets win over everything", () => {
    expect(d({ closed: "resolved", hasQuote: true })).toBe("closed_resolved");
    expect(d({ closed: "cancelled" })).toBe("closed_cancelled");
    expect(d({ closed: "secondary", connected: false })).toBe("closed_secondary");
  });
});

describe("stepMarksFor", () => {
  it("marks earlier steps done and the current step with the state's mark", () => {
    expect(stepMarksFor("verifying")).toEqual({
      quote: "done",
      build: "done",
      sign: "done",
      broadcast: "done",
      confirm: "done",
      verify: "active",
      attribute: "waiting",
    });
    expect(stepMarksFor("signature_rejected").sign).toBe("warn");
    expect(stepMarksFor("signature_rejected").broadcast).toBe("waiting");
    expect(stepMarksFor("tx_failed").confirm).toBe("failed");
    expect(stepMarksFor("quote_expired").quote).toBe("warn");
  });
  it("shows a slow verify as pending, not failed", () => {
    const m = stepMarksFor("verify_slow");
    expect(m.verify).toBe("pending");
    expect(m.attribute).toBe("pending");
    expect(Object.values(m)).not.toContain("failed");
  });
  it("only the attributed state completes every step", () => {
    for (const id of Object.keys(TRADE_STATES) as TradeStateId[]) {
      const all = STEP_ORDER.every((s) => stepMarksFor(id)[s] === "done");
      expect(all, id).toBe(id === "attributed");
    }
    expect(Object.values(stepMarksFor("disconnected")).every((m) => m === "waiting")).toBe(true);
  });
});

describe("TRADE_STATES copy", () => {
  it("every state explains itself and names its next action", () => {
    for (const [id, s] of Object.entries(TRADE_STATES)) {
      expect(s.title.length, id).toBeGreaterThan(3);
      expect(s.explain.length, id).toBeGreaterThan(10);
      if (s.action !== "none") expect(s.actionLabel, id).toBeTruthy();
    }
  });
  it("failure states say what is safe", () => {
    for (const id of ["quote_expired", "signature_rejected", "sign_failed", "broadcast_failed", "tx_failed", "submit_failed", "verify_failed", "presign_failed"] as const) {
      expect(TRADE_STATES[id].safe, id).toBeTruthy();
    }
  });
  it("never gives trading advice", () => {
    const advice = /\b(you should buy|you should sell|recommend|good entry|undervalued)\b/i;
    for (const s of Object.values(TRADE_STATES)) {
      expect(`${s.title} ${s.explain} ${s.safe ?? ""}`).not.toMatch(advice);
    }
  });
});
