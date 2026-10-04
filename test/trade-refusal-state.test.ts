/**
 * Panta's transient quote/build refusal (INVALID_MARKET_PARAMS → after the
 * bounded retry, PANTA_PRICING_UNAVAILABLE) is ticket state, not console
 * noise; unexpected failures still reach console.error; one request loop per
 * trigger (no duplicate / stacked retries).
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/primary-build.live-2026-10-03.json";
import { requestBuild, requestQuote } from "@/lib/panta/orders";
import { SchemaError } from "@/lib/panta/client";
import { describeErr } from "@/lib/errors";
import { SingleFlight } from "@/lib/single-flight";
import {
  classifyFailure,
  deriveTradeState,
  failureConsoleLevel,
  isPricingUnavailable,
  stepMarksFor,
  TRADE_STATES,
  type TradeSnapshot,
} from "@/lib/trade-state";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const IMP = () => json(400, { code: "INVALID_MARKET_PARAMS" }); // exactly what Panta sends (no detail)
function seq(...rs: (() => Response)[]) {
  let i = 0;
  const f = vi.fn<typeof fetch>(async () => rs[Math.min(i++, rs.length - 1)]());
  vi.stubGlobal("fetch", f);
  return f;
}
const fast = { sleep: async () => {}, random: () => 0 };
const qInput = { wallet: fixture.wallet, marketId: fixture.quote.marketId, side: "yes" as const, amountUsdc: "0.50" };
const bInput = { quoteId: fixture.quote.quoteId, wallet: fixture.wallet, maxSlippageBps: 100 };

const snap = (over: Partial<TradeSnapshot>): TradeSnapshot => ({
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
  ...over,
} as TradeSnapshot);

describe("expected refusal → explicit state", () => {
  it("quote: persistent INVALID_MARKET_PARAMS → quote_unavailable, friendly copy, no console.error", async () => {
    const err = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    seq(IMP);
    const e = await requestQuote(qInput, undefined, fast).catch((x) => x);
    expect(isPricingUnavailable(e)).toBe(true);
    const kind = classifyFailure("quote", e);
    expect(kind).toBe("quote_unavailable");
    expect(failureConsoleLevel(kind, e)).toBe("none");
    expect(describeErr(e)).toMatch(/^Panta couldn't price this right now — try again in a few seconds\. \(ref PANTA_PRICING_UNAVAILABLE\)$/);
    const spec = TRADE_STATES[kind];
    expect(spec).toMatchObject({ tone: "warning", action: "get_quote", actionLabel: "Try again", step: "quote", mark: "warn" });
    expect(spec.safe).toMatch(/inputs are fine.*no funds moved/i);
    expect(stepMarksFor(kind).quote).toBe("warn");
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
  it("build: persistent refusal → build_unavailable (retry the build with the same quote); expired quote → quote_expired", async () => {
    seq(IMP);
    const e = await requestBuild(bInput, undefined, fast).catch((x) => x);
    const kind = classifyFailure("build", e);
    expect(kind).toBe("build_unavailable");
    expect(failureConsoleLevel(kind, e)).toBe("none");
    expect(TRADE_STATES[kind]).toMatchObject({ tone: "warning", action: "review", actionLabel: "Try again", step: "build" });
    expect(deriveTradeState(snap({ failure: kind, hasQuote: true }))).toBe("build_unavailable");
    // quote ran out meanwhile → the only honest next step is a fresh quote
    expect(deriveTradeState(snap({ failure: kind, hasQuote: true, quoteExpired: true }))).toBe("quote_expired");
    // a pre-sign rejection is never downgraded to "unavailable"
    expect(classifyFailure("build", e, { presign: true })).toBe("presign_failed");
  });
  it("transient blip that recovers within the retries → no failure at all", async () => {
    seq(IMP, IMP, () => json(200, fixture.quote));
    const { quote } = await requestQuote(qInput, undefined, fast);
    expect(quote.quoteId).toBe(fixture.quote.quoteId);
  });
  it("other quote/build failures keep their existing states", () => {
    expect(classifyFailure("quote", new Error("x"))).toBe("quote_failed");
    expect(classifyFailure("build", Object.assign(new Error("QUOTE_EXPIRED"), { status: 400, body: { code: "QUOTE_EXPIRED" } }))).toBe("build_failed");
  });
});

describe("console policy: unexpected stays visible", () => {
  const api = (status: number, code: string) => Object.assign(new Error(code), { status, body: { code } });
  it("console.error for malformed responses, validation failures, 5xx after retries, network, unknown codes, programming errors", async () => {
    expect(failureConsoleLevel("quote_failed", new SchemaError("primary quote", "bad"))).toBe("error");
    expect(failureConsoleLevel("presign_failed", new Error("Panta instruction amount mismatch"))).toBe("error");
    seq(() => json(503, { code: "PANTA_UNREACHABLE" }));
    const e5 = await requestQuote(qInput, undefined, fast).catch((x) => x);
    expect(failureConsoleLevel(classifyFailure("quote", e5), e5)).toBe("error");
    expect(failureConsoleLevel("quote_failed", new TypeError("Failed to fetch"))).toBe("error");
    expect(failureConsoleLevel("quote_failed", api(400, "SOMETHING_NEW"))).toBe("error");
    expect(failureConsoleLevel("build_failed", new TypeError("cannot read properties of undefined"))).toBe("error");
    expect(failureConsoleLevel("broadcast_failed", new Error("rpc"))).toBe("error");
  });
  it("silent for outcomes the ticket already explains", () => {
    expect(failureConsoleLevel("signature_rejected", new Error("User rejected"))).toBe("none");
    expect(failureConsoleLevel("quote_expired", new Error("expired"))).toBe("none");
    for (const c of ["RATE_LIMITED", "QUOTE_STALE", "QUOTE_EXPIRED", "AMOUNT_TOO_SMALL", "MARKET_NOT_IN_PRIMARY"]) {
      expect(failureConsoleLevel("quote_failed", api(c === "RATE_LIMITED" ? 429 : 400, c)), c).toBe("none");
    }
    expect(failureConsoleLevel("quote_failed", Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe("none");
  });
  it("the ticket's fail() routes through the policy (no blanket suppression)", () => {
    const src = readFileSync("src/components/PrimaryBuyPanel.tsx", "utf8");
    const fail = src.slice(src.indexOf("const fail = (e: unknown)"), src.indexOf("const begin = ()"));
    expect(fail).toMatch(/if \(failureConsoleLevel\(kind, e\) === "error"\) \{\s*[\s\S]*console\.error\(/);
    expect(src).not.toMatch(/console\.(error|warn)\s*=|unhandledrejection/);
  });
});

describe("no duplicate requests / no stacked retries", () => {
  it("SingleFlight: concurrent triggers share one run; next trigger after settle runs again; errors propagate and clear", async () => {
    const sf = new SingleFlight<number>();
    let calls = 0;
    let release!: (v: number) => void;
    const fn = () => {
      calls++;
      return new Promise<number>((r) => (release = r));
    };
    const a = sf.run(fn);
    const b = sf.run(fn);
    expect(sf.running).toBe(true);
    expect(calls).toBe(1);
    release(5);
    expect(await a).toBe(5);
    expect(await b).toBe(5);
    expect(sf.running).toBe(false);
    await sf.run(async () => (calls++, 6));
    expect(calls).toBe(2);
    const boom = sf.run(async () => {
      throw new Error("boom");
    });
    const joined = sf.run(async () => 1);
    await expect(boom).rejects.toThrow("boom");
    await expect(joined).rejects.toThrow("boom");
    expect(await sf.run(async () => 7)).toBe(7);
    expect(await sf.run(() => {
      throw new Error("sync");
    }).catch((e) => e.message)).toBe("sync");
  });
  it("two concurrent quote triggers through SingleFlight → one 4-attempt loop, not 8 requests", async () => {
    const f = seq(IMP);
    const sf = new SingleFlight<unknown>();
    const go = () => sf.run(() => requestQuote(qInput, undefined, fast));
    const r = await Promise.allSettled([go(), go()]);
    expect(r.every((x) => x.status === "rejected")).toBe(true);
    expect(f).toHaveBeenCalledTimes(4);
  });
  it("panel wires quote and build through SingleFlight and aborts on unmount", () => {
    const src = readFileSync("src/components/PrimaryBuyPanel.tsx", "utf8");
    expect(src).toMatch(/const runQuote = \(\): Promise<Quote> => quoteFlight\.run\(\(\) => runQuoteOnce\(\)\)/);
    expect(src).toMatch(/const runBuild = \(q\?: Quote\): Promise<PrimaryBuild> => buildFlight\.run\(\(\) => runBuildOnce\(q\)\)/);
    expect(src.match(/signal: lifetime\.current\?\.signal/g)?.length).toBe(3); // quote, build, attribution report
    expect(src).toMatch(/return \(\) => ac\.abort\(\)/);
    // the retry loop lives only in orders.ts — nothing else calls quote/build
    expect(src.match(/await requestQuote\(/g)?.length).toBe(1);
    expect(src.match(/await requestBuild\(/g)?.length).toBe(1);
  });
  it("quote/build never go through React Query (its retry can't stack on ours)", () => {
    const files = ["src/components/PrimaryBuyPanel.tsx", "src/lib/data/hooks.ts", "src/lib/data/query-client.ts"];
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/use(Query|Mutation)\([\s\S]{0,400}(requestQuote|requestBuild|primaryorder)/);
    }
    expect(readFileSync("src/components/PrimaryBuyPanel.tsx", "utf8")).not.toMatch(/useMutation|useQuery\(/);
  });
  it("no effect auto-fires a quote or build (only clicks do)", () => {
    const src = readFileSync("src/components/PrimaryBuyPanel.tsx", "utf8");
    const effects = src.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
    for (const e of effects) expect(e).not.toMatch(/runQuote|runBuild|runGetQuote|runReview|requestQuote|requestBuild/);
  });
});
