/**
 * Bounded retry for Panta quote/build on the intermittent
 * INVALID_MARKET_PARAMS (+ 502/503/504/network). Never on 429, other codes,
 * abort, or for submit/verify/report. A build that arrives on a retry still
 * goes through the full strict check.
 */
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/primary-build.live-2026-10-03.json";
import { ApiError } from "@/lib/panta/client";
import type { Quote } from "@/lib/panta/domain";
import {
  checkBuild,
  PANTA_MAX_ATTEMPTS,
  PANTA_PRICING_UNAVAILABLE,
  PANTA_RETRY_DELAYS_MS,
  requestBuild,
  requestQuote,
  submitOrder,
  transientReason,
  verifyOrder,
  withPantaRetry,
} from "@/lib/panta/orders";
import { PANTA_USDC_PROGRAM_ID } from "@/lib/panta/instructions";
import { describeErr } from "@/lib/errors";

afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const IMP = () => json(400, { code: "INVALID_MARKET_PARAMS", detail: "invalid market params" });
const quoteBody = { ...fixture.quote };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** fetch stub returning the given responses in order (last one repeats). */
function seq(...rs: (() => Response | Promise<Response>)[]) {
  let i = 0;
  const f = vi.fn<typeof fetch>(async () => rs[Math.min(i++, rs.length - 1)]());
  vi.stubGlobal("fetch", f);
  return f;
}
const noSleep = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms), random: () => 0.5 };
};
const qInput = { wallet: fixture.wallet, marketId: fixture.quote.marketId, side: "no" as const, amountUsdc: "2.50" };
const bInput = { quoteId: fixture.quote.quoteId, wallet: fixture.wallet, maxSlippageBps: 100 };

describe("quote retry", () => {
  it("retries INVALID_MARKET_PARAMS then succeeds; backoff ~400/900 ms + jitter", async () => {
    const f = seq(IMP, IMP, () => json(200, quoteBody));
    const r = noSleep();
    const onRetry = vi.fn();
    const { quote } = await requestQuote(qInput, undefined, { ...r, onRetry });
    expect(quote.quoteId).toBe(fixture.quote.quoteId);
    expect(f).toHaveBeenCalledTimes(3);
    expect(r.waits).toEqual([400 + 75, 900 + 75]);
    expect(onRetry.mock.calls.map((c) => c[0].attempt)).toEqual([2, 3]);
    // identical request every time
    const bodies = f.mock.calls.map((c) => String(c[1]?.body));
    expect(new Set(bodies).size).toBe(1);
  });
  it(`gives up after ${PANTA_MAX_ATTEMPTS} attempts with the friendly error`, async () => {
    const f = seq(IMP);
    const r = noSleep();
    const err = await requestQuote(qInput, undefined, r).catch((e) => e);
    expect(f).toHaveBeenCalledTimes(4);
    expect(r.waits.length).toBe(3);
    expect(r.waits.map((w) => w - 75)).toEqual([...PANTA_RETRY_DELAYS_MS]);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).body).toMatchObject({ code: PANTA_PRICING_UNAVAILABLE, upstreamCode: "INVALID_MARKET_PARAMS", attempts: 4 });
    expect(describeErr(err)).toMatch(/^Panta couldn't price this right now — try again in a few seconds\./);
  });
  it("no retry on other 4xx codes", async () => {
    for (const code of ["AMOUNT_TOO_SMALL", "MARKET_NOT_IN_PRIMARY", "UNAUTHORIZED", "QUOTE_STALE"]) {
      const f = seq(() => json(400, { code }), () => json(200, quoteBody));
      const err = await requestQuote(qInput, undefined, noSleep()).catch((e) => e);
      expect(f).toHaveBeenCalledTimes(1);
      expect((err as ApiError).message).toBe(code);
    }
    const f = seq(() => json(404, { code: "MARKET_NOT_FOUND" }));
    await requestQuote(qInput, undefined, noSleep()).catch(() => null);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("no retry on 429 (Panta or our proxy limit), even with the transient code", async () => {
    for (const body of [{ code: "RATE_LIMITED" }, { code: "INVALID_MARKET_PARAMS" }]) {
      const f = seq(() => json(429, body), () => json(200, quoteBody));
      const err = await requestQuote(qInput, undefined, noSleep()).catch((e) => e);
      expect(f).toHaveBeenCalledTimes(1);
      expect((err as ApiError).status).toBe(429);
    }
  });
  it("no retry on 500 or a schema error; does retry 502/503/504 and network errors", async () => {
    let f = seq(() => json(500, { code: "INTERNAL_ERROR" }), () => json(200, quoteBody));
    await requestQuote(qInput, undefined, noSleep()).catch(() => null);
    expect(f).toHaveBeenCalledTimes(1);
    f = seq(() => json(200, { nope: true }), () => json(200, quoteBody));
    await expect(requestQuote(qInput, undefined, noSleep())).rejects.toThrow(/unexpected response shape/);
    expect(f).toHaveBeenCalledTimes(1);
    for (const status of [502, 503, 504]) {
      f = seq(() => json(status, { code: "UPSTREAM_TIMEOUT" }), () => json(200, quoteBody));
      expect((await requestQuote(qInput, undefined, noSleep())).quote.quoteId).toBe(fixture.quote.quoteId);
      expect(f).toHaveBeenCalledTimes(2);
    }
    f = seq(() => {
      throw new TypeError("Failed to fetch");
    }, () => json(200, quoteBody));
    expect((await requestQuote(qInput, undefined, noSleep())).quote.quoteId).toBe(fixture.quote.quoteId);
    // persistent 503 → original error after 4 attempts (not rewritten)
    f = seq(() => json(503, { code: "PANTA_UNREACHABLE" }));
    const err = await requestQuote(qInput, undefined, noSleep()).catch((e) => e);
    expect(f).toHaveBeenCalledTimes(4);
    expect((err as ApiError).body).toEqual({ code: "PANTA_UNREACHABLE" });
  });
  it("abort: no retry when fetch aborts; abort during backoff stops; pre-aborted never calls", async () => {
    let f = seq(() => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    await expect(requestQuote(qInput, undefined, noSleep())).rejects.toThrow(/aborted/);
    expect(f).toHaveBeenCalledTimes(1);

    const ac = new AbortController();
    f = seq(IMP, () => json(200, quoteBody));
    const p = requestQuote(qInput, undefined, { signal: ac.signal, onRetry: () => ac.abort() });
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(f).toHaveBeenCalledTimes(1); // real (default) sleep honoured the signal

    const pre = new AbortController();
    pre.abort();
    f = seq(() => json(200, quoteBody));
    await expect(requestQuote(qInput, undefined, { signal: pre.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(f).not.toHaveBeenCalled();
  });
  it("transientReason unit", () => {
    expect(transientReason(new ApiError(400, { code: "INVALID_MARKET_PARAMS" }))).toBe("INVALID_MARKET_PARAMS");
    expect(transientReason(new ApiError(422, { code: "INVALID_MARKET_PARAMS" }))).toBe("INVALID_MARKET_PARAMS");
    expect(transientReason(new ApiError(500, { code: "INVALID_MARKET_PARAMS" }))).toBeNull();
    expect(transientReason(new ApiError(429, { code: "INVALID_MARKET_PARAMS" }))).toBeNull();
    expect(transientReason(new ApiError(400, "INVALID_MARKET_PARAMS"))).toBeNull();
    expect(transientReason(new Error("x"))).toBeNull();
  });
});

describe("build retry", () => {
  const wallet = new PublicKey(fixture.wallet);
  const quote = { ...fixture.quote } as Quote;
  it("retries INVALID_MARKET_PARAMS with the same quoteId, and the final build passes the strict check", async () => {
    const f = seq(IMP, () => json(200, clone(fixture.build)));
    const { build } = await requestBuild(bInput, "usr_fixture", noSleep());
    expect(f).toHaveBeenCalledTimes(2);
    for (const c of f.mock.calls) expect(JSON.parse(String(c[1]?.body)).quoteId).toBe(fixture.quote.quoteId);
    expect(checkBuild(build, quote, wallet, 100).ok).toBe(true);
  });
  it("a tampered build arriving on the retry is still rejected", async () => {
    const amount = clone(fixture.build);
    const ix = amount.instructions.find((i: { programId: string }) => i.programId === PANTA_USDC_PROGRAM_ID)!;
    ix.data = Buffer.from("2e89447431590df701" + "40420f0000000000", "hex").toString("base64"); // NO, 1.00 USDC ≠ 2.50
    const shares = { ...clone(fixture.build), expectedShares: "4.0" }; // below the 1% floor
    const otherWallet = { ...clone(fixture.build), wallet: "11111111111111111111111111111112" };
    const otherQuote = { ...clone(fixture.build), quoteId: "qt_someone_else" };
    for (const bad of [amount, shares, otherWallet, otherQuote]) {
      seq(IMP, IMP, () => json(200, bad));
      const { build } = await requestBuild(bInput, undefined, noSleep());
      expect(checkBuild(build, quote, wallet, 100).ok).toBe(false);
    }
  });
  it("gives up with the friendly error; no retry on QUOTE_EXPIRED / QUOTE_STALE / 429", async () => {
    let f = seq(IMP);
    expect(describeErr(await requestBuild(bInput, undefined, noSleep()).catch((e) => e))).toMatch(/couldn't price this right now/);
    expect(f).toHaveBeenCalledTimes(4);
    for (const [s, code] of [[400, "QUOTE_EXPIRED"], [409, "QUOTE_STALE"], [429, "RATE_LIMITED"]] as const) {
      f = seq(() => json(s, { code }), () => json(200, clone(fixture.build)));
      await requestBuild(bInput, undefined, noSleep()).catch(() => null);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
  it("panel re-checks the quote guard and runs checkBuild on the returned build", () => {
    const src = readFileSync("src/components/PrimaryBuyPanel.tsx", "utf8");
    const run = src.slice(src.indexOf("const runBuild"), src.indexOf("const applyConfirm"));
    const after = run.slice(run.indexOf("await requestBuild("));
    expect(after.indexOf("enforceQuoteGuard(activeQuote, null)")).toBeGreaterThan(0);
    expect(after.indexOf("checkBuild(data, activeQuote")).toBeGreaterThan(after.indexOf("enforceQuoteGuard(activeQuote, null)"));
    expect(after.indexOf("setBuild(data)")).toBeGreaterThan(after.indexOf("checkBuild(data"));
  });
});

describe("never retried: submit / verify / trade report", () => {
  it("submit and verify make exactly one call even on INVALID_MARKET_PARAMS / 503", async () => {
    for (const r of [IMP, () => json(503, { code: "PANTA_UNREACHABLE" }), () => {
      throw new TypeError("Failed to fetch");
    }]) {
      let f = seq(r, () => json(200, { status: "submitted" }));
      await submitOrder({ orderId: "ord_1", signature: "sig", wallet: fixture.wallet }).catch(() => null);
      expect(f).toHaveBeenCalledTimes(1);
      f = seq(r, () => json(200, { status: "confirmed" }));
      await verifyOrder({ orderId: "ord_1", wallet: fixture.wallet }).catch(() => null);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
  it("withPantaRetry is only wired into quote and build", () => {
    const src = readFileSync("src/lib/panta/orders.ts", "utf8");
    expect(src.match(/await withPantaRetry\(/g)?.length).toBe(2); // quote + build only
    const tail = src.slice(src.indexOf("export async function submitOrder("));
    expect(tail).not.toMatch(/withPantaRetry/);
    for (const f of ["src/lib/panta/trades.ts", "src/lib/panta/claims.ts", "src/components/BookPanel.tsx"]) {
      try {
        expect(readFileSync(f, "utf8")).not.toMatch(/withPantaRetry/);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
  });
  it("worst case per click stays inside the proxy limits", async () => {
    const { PROXY_LIMITS } = await import("@/lib/panta/routes");
    expect(PANTA_MAX_ATTEMPTS).toBe(4);
    expect(PROXY_LIMITS.quote.perMinute / PANTA_MAX_ATTEMPTS).toBeGreaterThanOrEqual(5);
    expect(PROXY_LIMITS.build.perMinute / PANTA_MAX_ATTEMPTS).toBeGreaterThanOrEqual(5);
    // total backoff < 4 s so a 30 s quote isn't burned by retries
    expect(PANTA_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) + 3 * 150).toBeLessThan(4_000);
  });
});

it("withPantaRetry passes successes through untouched", async () => {
  expect(await withPantaRetry(async () => 7)).toBe(7);
});
