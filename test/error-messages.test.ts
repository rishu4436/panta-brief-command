/** P3 #1: raw codes never reach the UI on their own; one mapping turns them into text. */
import { describe, expect, it } from "vitest";
import { describeErr } from "@/lib/errors";
import { ERROR_MESSAGES, humanError } from "@/lib/error-messages";
import { ApiError } from "@/lib/panta/client";

const startsReadable = (s: string, code: string) => {
  expect(s.startsWith(code)).toBe(false);
  expect(s).toMatch(/^[A-Z][a-z]/);
};

describe("error code mapping", () => {
  it("PANTA_TRADES_MALFORMED body → readable text with a ref, not the code", () => {
    const e = new ApiError(502, { code: "PANTA_TRADES_MALFORMED", detail: "trades page did not match the schema" });
    const s = describeErr(e);
    startsReadable(s, "PANTA_TRADES_MALFORMED");
    expect(s).toBe(`${ERROR_MESSAGES.PANTA_TRADES_MALFORMED} (ref PANTA_TRADES_MALFORMED)`);
    expect(s).not.toContain("schema"); // internal detail stays out of the UI
  });
  it("Panta upstream codes are mapped (QUOTE_EXPIRED, QUOTE_STALE, RATE_LIMITED)", () => {
    expect(describeErr(new ApiError(400, { code: "QUOTE_EXPIRED", message: "quoteId expired" }))).toMatch(/^This quote has expired\. Get a new quote\./);
    expect(describeErr(new ApiError(400, { code: "QUOTE_STALE" }))).toMatch(/slippage/);
    expect(describeErr(new ApiError(429, { code: "RATE_LIMITED" }))).toMatch(/^Too many requests/);
  });
  it("validation codes keep Panta's message (it says what to fix)", () => {
    expect(describeErr(new ApiError(400, { code: "AMOUNT_TOO_SMALL", message: "minimum is 1.00 USDC" }))).toBe(
      "The amount is below Panta's minimum fill. minimum is 1.00 USDC. (ref AMOUNT_TOO_SMALL)",
    );
  });
  it("PANTA_HTTP_<n> and unknown codes get a generic sentence by status", () => {
    expect(humanError("PANTA_HTTP_503", null, 502)).toBe("Panta returned an error. Try again shortly. (ref PANTA_HTTP_503)");
    expect(humanError("WEIRD_NEW_CODE", "x", 500)).toBe("The service had a problem. Try again shortly. (ref WEIRD_NEW_CODE)");
  });
  it("a bare code as an Error message or string is mapped too", () => {
    startsReadable(describeErr(new Error("PANTA_UNREACHABLE")), "PANTA_UNREACHABLE");
    startsReadable(describeErr("UPSTREAM_TIMEOUT"), "UPSTREAM_TIMEOUT");
  });
  it("proxy envelopes using `error` instead of `code` are mapped", () => {
    startsReadable(describeErr(new ApiError(403, { error: "ROUTE_NOT_ALLOWED" })), "ROUTE_NOT_ALLOWED");
  });
  it("plain human messages pass through unchanged", () => {
    expect(describeErr(new Error("Connect a signing wallet"))).toBe("Connect a signing wallet");
    expect(describeErr(new ApiError(400, { detail: "marketId required" }))).toBe("marketId required");
  });
  it("every mapped message is a sentence, not a code", () => {
    for (const [code, msg] of Object.entries(ERROR_MESSAGES)) {
      expect(msg, code).toMatch(/^[A-Z][a-z']/);
      expect(msg, code).not.toMatch(/[A-Z]{3,}_[A-Z]/);
    }
  });
});

describe("client fetchers keep the body so the mapping applies", () => {
  it("catalog fetch error is an ApiError with the code", async () => {
    const { vi } = await import("vitest");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "BRIEF_FAILED", detail: "boom" }), { status: 502 })));
    const { fetchCatalog } = await import("@/lib/panta/markets");
    const err = await fetchCatalog().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(describeErr(err)).toMatch(/^The brief couldn't be generated/);
    vi.unstubAllGlobals();
  });
});
