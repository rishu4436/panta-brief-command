/**
 * Per-IP rate limits on the /api/panta proxy: write paths are tighter than
 * reads, a full trade with retries fits, and a limited request never reaches
 * Panta (no key spent).
 */
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PROXY_LIMITS, PROXY_ROUTES } from "@/lib/panta/routes";

type Handler = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;
let GET: Handler;
let POST: Handler;

beforeAll(async () => {
  process.env.PANTA_API_KEY = "pk_test_vitest_dummy";
  const mod = await import("@/app/api/panta/[...path]/route");
  GET = mod.GET as unknown as Handler;
  POST = mod.POST as unknown as Handler;
});
afterEach(() => vi.unstubAllGlobals());

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });
let ipSeq = 0;
const freshIp = () => `203.0.113.${++ipSeq}`;
function mockUpstream() {
  const f = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
}
const post = (path: string, ip: string) =>
  POST(
    new NextRequest(`http://localhost/api/panta/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": ip },
      body: "{}",
    }),
    ctx(path.split("/")),
  );
const get = (path: string, ip: string) =>
  GET(new NextRequest(`http://localhost/api/panta/${path}`, { headers: { "x-vercel-forwarded-for": ip } }), ctx(path.split("/")));

describe("proxy rate limits", () => {
  it("every allowlisted route has a limit; writes are tighter than reads", () => {
    for (const r of PROXY_ROUTES) {
      expect(r.limit.perMinute).toBeGreaterThan(0);
      if (r.methods.includes("POST")) expect(r.limit.perMinute).toBeLessThan(PROXY_LIMITS.read.perMinute);
      else expect(r.limit).toBe(PROXY_LIMITS.read);
    }
  });

  it("limits are generous enough for a full trade with retries in one minute", () => {
    // 5 quotes (re-quote on expiry/changes), 3 builds, 2 submits, ~15 verify polls ×2, 2 reports, 2 claim builds.
    expect(PROXY_LIMITS.quote.perMinute).toBeGreaterThanOrEqual(5 * 3);
    expect(PROXY_LIMITS.build.perMinute).toBeGreaterThanOrEqual(3 * 3);
    expect(PROXY_LIMITS.submit.perMinute).toBeGreaterThanOrEqual(2 * 3);
    expect(PROXY_LIMITS.verify.perMinute).toBeGreaterThanOrEqual(30);
    expect(PROXY_LIMITS.report.perMinute).toBeGreaterThanOrEqual(2 * 3);
    expect(PROXY_LIMITS.claimBuild.perMinute).toBeGreaterThanOrEqual(2 * 3);
  });

  it("write path: headers on success, 429 + Retry-After past the limit, upstream not called", async () => {
    const f = mockUpstream();
    const ip = freshIp();
    const n = PROXY_LIMITS.build.perMinute;
    for (let i = 0; i < n; i++) {
      const res = await post("primaryorderbuild", ip);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-ratelimit-limit")).toBe(String(n));
      expect(res.headers.get("x-ratelimit-remaining")).toBe(String(n - i - 1));
      expect(res.headers.get("x-store-status")).toMatch(/^mode=/);
    }
    expect(f).toHaveBeenCalledTimes(n);
    const limited = await post("primaryorderbuild", ip);
    expect(limited.status).toBe(429);
    expect((await limited.json()).code).toBe("RATE_LIMITED");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(f).toHaveBeenCalledTimes(n); // no key spent on a limited request
  });

  it("buckets are per IP and per action: another IP, or a read, still works", async () => {
    mockUpstream();
    const ip = freshIp();
    for (let i = 0; i < PROXY_LIMITS.claimBuild.perMinute; i++) await post("claim/build", ip);
    expect((await post("claim/build", ip)).status).toBe(429);
    expect((await post("claim/creator-fees/build", ip)).status).toBe(429); // same claim bucket
    expect((await post("claim/build", freshIp())).status).toBe(200);
    expect((await post("primaryorderquote", ip)).status).toBe(200);
    expect((await get("markets", ip)).status).toBe(200);
  });

  it("reads: a heavy page load (60 calls) is nowhere near the read limit", async () => {
    mockUpstream();
    const ip = freshIp();
    let last: Response | null = null;
    for (let i = 0; i < 60; i++) last = await get("markets", ip);
    expect(last!.status).toBe(200);
    expect(Number(last!.headers.get("x-ratelimit-remaining"))).toBe(PROXY_LIMITS.read.perMinute - 60);
  });

  it("disallowed routes are refused before counting", async () => {
    mockUpstream();
    const ip = freshIp();
    const res = await get("admin/keys", ip);
    expect(res.status).toBe(403);
    expect(res.headers.get("x-ratelimit-limit")).toBeNull();
  });
});
