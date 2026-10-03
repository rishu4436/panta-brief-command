/**
 * Audit (Oct 2026 test pass): a quote (and any build made from it) is stale
 * once the ticket's market, side or amount changes. PrimaryBuyPanel uses
 * isQuoteStale both for the UI state and as a hard stop before signing.
 */
import { describe, expect, it } from "vitest";
import { isQuoteStale } from "@/lib/trade-state";

const M = "5cyMGUVDcToJ8ws5V1sKkGnzthLrLTsqEjo3Pa2HNU8v";
const OTHER = "Dhtmh7zc6c2281UTSBdSzxBAiL7wasK51BqWS2waShd6";
const quote = { marketId: M, side: "yes", amountUsdc: "1.00" };

describe("audit: isQuoteStale", () => {
  it("no quote is never stale", () => {
    expect(isQuoteStale(null, { marketId: M, side: "yes", amountUsdc: "1.00" })).toBe(false);
  });
  it("matching inputs are fresh (amount compared numerically)", () => {
    expect(isQuoteStale(quote, { marketId: ` ${M} `, side: "yes", amountUsdc: "1" })).toBe(false);
  });
  it("another market is stale (e.g. navigating to a different market page)", () => {
    expect(isQuoteStale(quote, { marketId: OTHER, side: "yes", amountUsdc: "1.00" })).toBe(true);
  });
  it("a flipped side is stale", () => {
    expect(isQuoteStale(quote, { marketId: M, side: "no", amountUsdc: "1.00" })).toBe(true);
  });
  it("a changed amount is stale", () => {
    expect(isQuoteStale(quote, { marketId: M, side: "yes", amountUsdc: "25.00" })).toBe(true);
  });
  it("an amount that is no longer valid is stale", () => {
    expect(isQuoteStale(quote, { marketId: M, side: "yes", amountUsdc: null })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// quoteGuard: the single rule run before build AND before sign (Guided and
// Step-by-step). Every stale condition has its own case.

import { quoteGuard, type BuildBinding, type TicketInputs } from "@/lib/trade-state";

const W = "4VGFQKGanc5oaLf51mee9m45HmiXRhKruh5mdRaM";
const W2 = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const T0 = Date.UTC(2026, 9, 3, 5, 0, 0);
const q = { marketId: M, side: "yes", amountUsdc: "1.00", expiresAt: new Date(T0 + 30_000).toISOString() };
const bind = { wallet: W, receivedAtMs: T0 };
const inputs = (over: Partial<TicketInputs> = {}): TicketInputs => ({
  marketId: M,
  side: "yes",
  amountUsdc: "1.00",
  wallet: W,
  slippageBps: 100,
  ...over,
});
const built: BuildBinding = { wallet: W, slippageBps: 100, buildWallet: W };
const reason = (r: ReturnType<typeof quoteGuard>) => (r.ok ? "ok" : r.reason);

describe("quoteGuard", () => {
  it("fresh quote + matching build passes", () => {
    expect(quoteGuard(q, bind, inputs(), T0 + 1_000)).toEqual({ ok: true });
    expect(quoteGuard(q, bind, inputs(), T0 + 1_000, built)).toEqual({ ok: true });
  });
  it("no quote / no binding", () => {
    expect(reason(quoteGuard(null, bind, inputs(), T0))).toBe("no_quote");
    expect(reason(quoteGuard(q, null, inputs(), T0))).toBe("no_quote");
  });
  it("market changed", () => {
    expect(reason(quoteGuard(q, bind, inputs({ marketId: OTHER }), T0))).toBe("market_changed");
  });
  it("side changed", () => {
    expect(reason(quoteGuard(q, bind, inputs({ side: "no" }), T0))).toBe("side_changed");
  });
  it("amount changed / invalid", () => {
    expect(reason(quoteGuard(q, bind, inputs({ amountUsdc: "2.00" }), T0))).toBe("amount_changed");
    expect(reason(quoteGuard(q, bind, inputs({ amountUsdc: null }), T0))).toBe("amount_invalid");
  });
  it("quote expired (Panta expiresAt)", () => {
    // Panta's expiresAt minus the 5 s safety margin.
    expect(reason(quoteGuard(q, bind, inputs(), T0 + 25_000))).toBe("expired");
    expect(reason(quoteGuard(q, bind, inputs(), T0 + 24_000))).toBe("ok");
  });
  it("quote expired (fallback TTL when Panta gives no expiresAt)", () => {
    const noExp = { ...q, expiresAt: null };
    expect(reason(quoteGuard(noExp, bind, inputs(), T0 + 10 * 60_000))).toBe("expired");
  });
  it("wallet switched or disconnected after the quote", () => {
    expect(reason(quoteGuard(q, bind, inputs({ wallet: W2 }), T0))).toBe("wallet_changed");
    expect(reason(quoteGuard(q, bind, inputs({ wallet: null }), T0))).toBe("wallet_changed");
  });
  it("build made for another wallet (fee payer / owner mismatch)", () => {
    expect(reason(quoteGuard(q, bind, inputs(), T0, { ...built, buildWallet: W2 }))).toBe("build_wallet_mismatch");
    expect(reason(quoteGuard(q, { wallet: W2, receivedAtMs: T0 }, inputs({ wallet: W2 }), T0, built))).toBe(
      "build_wallet_mismatch",
    );
  });
  it("slippage changed or invalid after build → rebuild", () => {
    const r = quoteGuard(q, bind, inputs({ slippageBps: 250 }), T0, built);
    expect(reason(r)).toBe("slippage_changed");
    if (!r.ok) expect(r.fix).toBe("rebuild");
    expect(reason(quoteGuard(q, bind, inputs({ slippageBps: null }), T0, built))).toBe("slippage_invalid");
    // Slippage does not affect the quote itself (it is a build parameter).
    expect(reason(quoteGuard(q, bind, inputs({ slippageBps: 250 }), T0))).toBe("ok");
  });
  it("every failure carries a user-facing message", () => {
    const r = quoteGuard(q, bind, inputs({ side: "no" }), T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/new quote/);
  });
  it("isQuoteStale reports a wallet change when both wallets are given", () => {
    expect(isQuoteStale(quote, { marketId: M, side: "yes", amountUsdc: "1.00", wallet: W2 }, W)).toBe(true);
    expect(isQuoteStale(quote, { marketId: M, side: "yes", amountUsdc: "1.00", wallet: W }, W)).toBe(false);
  });
});
