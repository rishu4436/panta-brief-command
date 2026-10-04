/**
 * Primary-buy attribution (POST /trades/): bounded retry on Panta's transient
 * 400 INVALID_MARKET_PARAMS only; exhausted → needs_attention state (trade
 * stays verified); manual "Retry attribution" re-sends the stored payload and
 * never touches quote/build/sign/submit/verify; single-flight.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ATTRIBUTION_MAX_ATTEMPTS,
  ATTRIBUTION_RETRY_DELAYS_MS,
  attributionFromReport,
  isAttributionUnavailable,
  isTransientAttributionRefusal,
  reportTrade,
  reportTradeWithRetry,
  type TradeReportInput,
} from "@/lib/panta/attribution";
import { ApiError } from "@/lib/panta/client";
import { describeErr } from "@/lib/errors";
import { SingleFlight } from "@/lib/single-flight";
import {
  classifyFailure,
  deriveTradeState,
  failureConsoleLevel,
  stepMarksFor,
  TRADE_STATES,
  type TradeSnapshot,
} from "@/lib/trade-state";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SIG = "2Ssk5nVrv73aayjzDMjvR1dzCzfpZvhBqiteXHu9mrGh7JzcBmCCtYZKw6s6Z5oyUXATECNMEjodwzYYjNykPav6";
const input: TradeReportInput = Object.freeze({
  signature: SIG,
  wallet: "Cd4PjMt5Ptv2iVTtKNndFwi7hCFSwBKc4yJjb34TyNYa",
  marketId: "5cyMGUVDcToJ8ws5V1sKkGnzthLrLTsqEjo3Pa2HNU8v",
  quoteId: "qt_792de3d5b1af452d955256a30736bfca",
  clientOrderId: "ord_b0f8088fda094b73ae4919471323f391",
});
const REF = "usr_fixture";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const IMP = () => json(400, { code: "INVALID_MARKET_PARAMS" });
const OK = (status = "processed") => () => json(200, { signature: SIG, status });
function seq(...rs: (() => Response)[]) {
  let i = 0;
  const f = vi.fn<typeof fetch>(async () => rs[Math.min(i++, rs.length - 1)]());
  vi.stubGlobal("fetch", f);
  return f;
}
const fast = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms), random: () => 0 };
};
const bodies = (f: ReturnType<typeof seq>) => f.mock.calls.map((c) => ({ url: String(c[0]), body: String(c[1]?.body), userId: (c[1]?.headers as Record<string, string>)["X-User-Id"] }));

describe("retry policy", () => {
  it("first attempt succeeds → one call, no waits", async () => {
    const f = seq(OK());
    const t = fast();
    const r = await reportTradeWithRetry(input, REF, t);
    expect(r.state).toBe("attributed");
    expect(f).toHaveBeenCalledTimes(1);
    expect(t.waits).toEqual([]);
  });
  it("transient then success; identical payload, URL and ref on every attempt; waits 1.5 s / 3 s", async () => {
    const f = seq(IMP, IMP, OK("pending"));
    const t = fast();
    const onRetry = vi.fn();
    const r = await reportTradeWithRetry(input, REF, { ...t, onRetry });
    expect(r.state).toBe("reported");
    expect(f).toHaveBeenCalledTimes(3);
    const b = bodies(f);
    expect(new Set(b.map((x) => x.body)).size).toBe(1);
    expect(b.every((x) => x.url === "/api/panta/trades" && x.userId === REF)).toBe(true);
    expect(JSON.parse(b[0].body)).toEqual({ ...input, userId: REF });
    expect(t.waits).toEqual([1500, 3000]);
    expect(onRetry.mock.calls.map((c) => c[0].attempt)).toEqual([2, 3]);
  });
  it(`all ${ATTRIBUTION_MAX_ATTEMPTS} attempts refused → ATTRIBUTION_UNAVAILABLE`, async () => {
    const f = seq(IMP);
    const t = fast();
    const e = await reportTradeWithRetry(input, REF, t).catch((x) => x);
    expect(f).toHaveBeenCalledTimes(4);
    expect(t.waits).toEqual([...ATTRIBUTION_RETRY_DELAYS_MS]);
    expect(isAttributionUnavailable(e)).toBe(true);
    expect(describeErr(e)).toMatch(/already verified on-chain/);
  });
  it("jitter is bounded (≤300 ms) and total wait stays ~10.5–11.4 s", async () => {
    seq(IMP);
    const t = { ...fast(), random: () => 0.999 };
    await reportTradeWithRetry(input, REF, t).catch(() => null);
    const total = t.waits.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(10_500);
    expect(total).toBeLessThan(11_400);
  });
  it.each([
    ["other 400 code", () => json(400, { code: "TX_MISMATCH" })],
    ["400 without a code", () => json(400, { detail: "x" })],
    ["400 non-JSON", () => new Response("Bad Request", { status: 400 })],
    ["401", () => json(401, { code: "UNAUTHORIZED" })],
    ["403", () => json(403, { code: "FORBIDDEN" })],
    ["404", () => json(404, { code: "TX_NOT_FOUND" })],
    ["429 (not swallowed)", () => json(429, { code: "RATE_LIMITED" })],
    ["429 with the transient code", () => json(429, { code: "INVALID_MARKET_PARAMS" })],
    ["500", () => json(500, { code: "INTERNAL_ERROR" })],
    ["502 proxy", () => json(502, { code: "PROXY_UNREACHABLE" })],
    ["422 with the transient code", () => json(422, { code: "INVALID_MARKET_PARAMS" })],
  ])("%s → no retry, original error surfaces", async (_l, r) => {
    const f = seq(r, OK());
    const e = await reportTradeWithRetry(input, REF, fast()).catch((x) => x);
    expect(f).toHaveBeenCalledTimes(1);
    expect(e).toBeInstanceOf(ApiError);
    expect(isAttributionUnavailable(e)).toBe(false);
  });
  it("network error and programming errors → no retry, distinct from unavailable", async () => {
    let f = seq(() => {
      throw new TypeError("Failed to fetch");
    }, OK());
    const n = await reportTradeWithRetry(input, REF, fast()).catch((x) => x);
    expect(f).toHaveBeenCalledTimes(1);
    expect(n).toBeInstanceOf(TypeError);
    const report = vi.fn(async () => {
      throw new RangeError("bug");
    });
    await expect(reportTradeWithRetry(input, REF, { ...fast(), report: report as never })).rejects.toThrow("bug");
    expect(report).toHaveBeenCalledTimes(1);
    f = seq(() => json(200, "not-an-object"));
    const r = await reportTradeWithRetry(input, REF, fast());
    expect(f).toHaveBeenCalledTimes(1);
    expect(r.state).toBe("reported"); // existing lenient report parsing unchanged
  });
  it("abort: pre-aborted never calls; abort during a wait stops further attempts", async () => {
    let f = seq(OK());
    const pre = new AbortController();
    pre.abort();
    await expect(reportTradeWithRetry(input, REF, { signal: pre.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(f).not.toHaveBeenCalled();
    f = seq(IMP, OK());
    const ac = new AbortController();
    await expect(reportTradeWithRetry(input, REF, { signal: ac.signal, onRetry: () => ac.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("classifier unit", () => {
    expect(isTransientAttributionRefusal(new ApiError(400, { code: "INVALID_MARKET_PARAMS" }))).toBe(true);
    expect(isTransientAttributionRefusal(new ApiError(400, { code: "INVALID_JSON" }))).toBe(false); // our proxy's own 400
    expect(isTransientAttributionRefusal(new Error("INVALID_MARKET_PARAMS"))).toBe(false);
  });
  it("existing processed / reported mapping and plain reportTrade (used by Book claims) unchanged: no retry", async () => {
    expect(attributionFromReport("processed")).toBe("attributed");
    expect(attributionFromReport("pending")).toBe("reported");
    const f = seq(IMP, OK());
    await expect(reportTrade(input, REF)).rejects.toBeInstanceOf(ApiError);
    expect(f).toHaveBeenCalledTimes(1);
    expect(readFileSync("src/components/BookPanel.tsx", "utf8")).not.toMatch(/reportTradeWithRetry/);
  });
});

describe("state machine", () => {
  const snap = (over: Partial<TradeSnapshot>): TradeSnapshot => ({
    connected: true,
    closed: null,
    running: null,
    failure: null,
    hasQuote: true,
    quoteExpired: false,
    quoteStale: false,
    hasBuild: true,
    presignOk: true,
    reviewOpen: false,
    hasSignature: true,
    txPhase: "confirmed",
    verifyPhase: "confirmed",
    attrPhase: "idle",
    ...over,
  });
  it("confirmed → verified → reporting → reported / attributed", () => {
    expect(deriveTradeState(snap({ verifyPhase: "idle" }))).toBe("confirmed");
    expect(deriveTradeState(snap({}))).toBe("verified");
    expect(deriveTradeState(snap({ running: "attribute", attrPhase: "reporting" }))).toBe("reporting");
    expect(deriveTradeState(snap({ attrPhase: "reporting" }))).toBe("reporting");
    // existing mapping kept: reported + verified shows "verified" (ledger check pending);
    // reported without a Panta verify shows "reported"
    expect(deriveTradeState(snap({ attrPhase: "reported" }))).toBe("verified");
    expect(deriveTradeState(snap({ attrPhase: "reported", verifyPhase: "timeout" }))).toBe("verify_slow");
    expect(deriveTradeState(snap({ attrPhase: "reported", verifyPhase: "idle" }))).toBe("reported");
    expect(deriveTradeState(snap({ attrPhase: "attributed" }))).toBe("attributed");
  });
  it("verified + exhausted transient refusal → attribution_needs_attention; manual retry → reporting", () => {
    const s = snap({ attrPhase: "needs_attention" });
    expect(deriveTradeState(s)).toBe("attribution_needs_attention");
    expect(deriveTradeState({ ...s, running: "attribute" })).toBe("reporting");
    expect(deriveTradeState({ ...s, attrPhase: "attributed" })).toBe("attributed");
  });
  it("Needs attention copy: verified, temporarily unavailable, no funds/sign; earlier steps Completed", () => {
    const spec = TRADE_STATES.attribution_needs_attention;
    expect(spec.title).toBe("Needs attention");
    expect(spec.explain).toMatch(/already verified on-chain/);
    expect(spec.explain).toMatch(/temporarily unavailable/);
    expect(spec.safe).toMatch(/does not move funds or sign a transaction/);
    expect(spec).toMatchObject({ tone: "warning", action: "retry_attribution", actionLabel: "Retry attribution" });
    expect(`${spec.title} ${spec.explain} ${spec.safe}`).not.toMatch(/\bfail/i);
    for (const id of ["attribution_needs_attention", "reporting"] as const) {
      const m = stepMarksFor(id);
      for (const st of ["quote", "build", "sign", "broadcast", "confirm", "verify"] as const) expect(m[st], `${id}:${st}`).toBe("done");
      expect(Object.values(m)).not.toContain("failed");
    }
    expect(stepMarksFor("attribution_needs_attention").attribute).toBe("warn");
  });
  it("genuine attribution failures stay distinct and console.error'd; transient path is silent", () => {
    const e500 = new ApiError(500, { code: "INTERNAL_ERROR" });
    const kind = classifyFailure("attribute", e500);
    expect(kind).not.toBe("attribution_needs_attention");
    expect(failureConsoleLevel(kind, e500)).toBe("error");
    expect(failureConsoleLevel("submit_failed", new ApiError(400, { code: "TX_MISMATCH" }))).toBe("error");
    // the transient path never reaches fail(): sendReport returns after setting needs_attention
    const src = readFileSync("src/components/PrimaryBuyPanel.tsx", "utf8");
    const send = src.slice(src.indexOf("const sendReport = async"), src.indexOf("const runAttributeOnce"));
    expect(send).toMatch(/if \(isAttributionUnavailable\(e\)\) \{\s*setAttrPhase\("needs_attention"\);[\s\S]*?return;\s*\}\s*throw e;/);
    expect(send).not.toMatch(/console\./);
  });
});

describe("manual retry + single-flight (panel wiring)", () => {
  const src = readFileSync("src/components/PrimaryBuyPanel.tsx", "utf8");
  const body = (start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end));
  const retry = body("const runRetryAttribution = async", "const fail = (e: unknown)");
  const send = body("const sendReport = async", "const runAttributeOnce");
  it("Retry attribution only re-sends the stored payload for the current confirmed signature", () => {
    expect(retry).toMatch(/const payload = reportPayload\.current;/);
    expect(retry).toMatch(/payload\.input\.signature !== signature \|\| txPhase !== "confirmed"/);
    expect(retry).toMatch(/attributionFlight\.run\(\(\) => sendReport\(payload\)\)/);
  });
  it("Retry path cannot reach quote / build / sign / broadcast / submit / verify", () => {
    const forbidden = /runQuote|runBuild|requestQuote|requestBuild|checkBuild|runSignBroadcast|signTransaction|sendRawTransaction|runSubmit|submitOrder|runVerify|verifyOrder|runApprove|runCheckConfirmation|requireReady/;
    expect(retry).not.toMatch(forbidden);
    expect(send).not.toMatch(forbidden);
    expect(send).toMatch(/reportTradeWithRetry\(payload\.input, payload\.userId, \{\s*signal: lifetime\.current\?\.signal/);
  });
  it("payload captured once (frozen) from the confirmed trade; automatic reports join one flight", () => {
    const once = body("const runAttributeOnce = async", "const runAttribute = (");
    expect(once).toMatch(/input: Object\.freeze\(\{\s*signature: sig,\s*wallet: publicKey!\.toBase58\(\),\s*marketId: built\.marketId,\s*quoteId: built\.quoteId,\s*clientOrderId: built\.orderId,\s*\}\)/);
    expect(once).toMatch(/userId: sessionAttrRef\.current/);
    expect(src).toMatch(/const runAttribute = \(opts\?: \{ built\?: PrimaryBuild; sig\?: string \}\): Promise<void> =>\s*attributionFlight\.run\(\(\) => runAttributeOnce\(opts\)\)/);
    expect(src).toMatch(/case "retry_attribution":\s*return \{ onAction: \(\) => void runRetryAttribution\(\), disabled: busy \}/);
  });
  it("ledger reconciliation after a non-definitive success is unchanged", () => {
    expect(send).toMatch(/void checkLedger\(payload\.input\.signature, definitive\)/);
    expect(src).toMatch(/const LEDGER_CHECK_DELAYS_MS = \[1500, 3000, 5000\] as const;/);
  });
  it("duplicate clicks → one retry sequence (SingleFlight + same stored payload)", async () => {
    const f = seq(IMP, IMP, OK());
    const flight = new SingleFlight<void>();
    const payload = { input, userId: REF };
    const send = () => reportTradeWithRetry(payload.input, payload.userId, fast()).then(() => undefined);
    await Promise.all([flight.run(send), flight.run(send), flight.run(send)]);
    expect(f).toHaveBeenCalledTimes(3); // one sequence: 2 refusals + 1 success, not 9
    expect(bodies(f).every((b) => b.url === "/api/panta/trades")).toBe(true);
  });
  it("manual retry after needs_attention succeeds with the same payload and only hits /trades", async () => {
    let f = seq(IMP);
    const first = await reportTradeWithRetry(input, REF, fast()).catch((e) => e);
    expect(isAttributionUnavailable(first)).toBe(true);
    const firstBodies = bodies(f).map((b) => b.body);
    f = seq(OK());
    const r = await reportTradeWithRetry(input, REF, fast());
    expect(r.state).toBe("attributed");
    expect(bodies(f)[0].body).toBe(firstBodies[0]);
    expect(f.mock.calls.every((c) => String(c[0]) === "/api/panta/trades")).toBe(true);
  });
});
