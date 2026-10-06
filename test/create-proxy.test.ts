/**
 * Phase 3 · Create Market — /api/panta proxy: exactly four explicit POST
 * routes, strict server-side bodies (nothing invalid reaches Panta with the
 * server key), per-IP limits, no client key forwarding, account ids stripped.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PROXY_LIMITS, PROXY_ROUTES, matchProxyRoute } from "@/lib/panta/routes";
import { FX, inputOf } from "./create-helpers";

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

let ipSeq = 0;
const freshIp = () => `198.51.100.${++ipSeq}`;
const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
function mockUpstream(body: unknown = { ok: true }) {
  const f = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
}
const post = (path: string, body: unknown, ip = freshIp(), headers: Record<string, string> = {}) =>
  POST(
    new NextRequest(`http://localhost/api/panta/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": ip, ...headers },
      body: JSON.stringify(body),
    }),
    ctx(path),
  );

const quoteBody = () => {
  const i = inputOf(FX.breaking);
  return { ...i };
};

describe("create routes in the allowlist", () => {
  it("exactly four explicit POST-only create entries, no wildcard", () => {
    const create = PROXY_ROUTES.filter((r) => r.id.startsWith("create."));
    expect(create.map((r) => r.id).sort()).toEqual(["create.build", "create.imageUpload", "create.quote", "create.register"]);
    for (const r of create) {
      expect(r.methods).toEqual(["POST"]);
      expect(r.bodyValidator).toBeTruthy();
    }
    for (const p of ["markets/create", "markets/create/other", "markets/create/quote/x", "markets/register/x", "markets/create/image-upload/extra"]) {
      expect(matchProxyRoute(p)).toBeNull();
    }
  });
  it("limits: image-upload 10, quote 10, build 6, register 10 per minute; primary limits unchanged", () => {
    expect(PROXY_LIMITS.createImageUpload.perMinute).toBe(10);
    expect(PROXY_LIMITS.createQuote.perMinute).toBe(10);
    expect(PROXY_LIMITS.createBuild.perMinute).toBe(6);
    expect(PROXY_LIMITS.createRegister.perMinute).toBe(10);
    expect(PROXY_LIMITS.quote.perMinute).toBe(30);
    expect(PROXY_LIMITS.build.perMinute).toBe(20);
    expect(PROXY_LIMITS.submit.perMinute).toBe(20);
    expect(PROXY_LIMITS.verify.perMinute).toBe(90);
  });
  it("GET on a create route is 405; unknown create path is 403", async () => {
    const f = mockUpstream();
    const r = await GET(new NextRequest("http://localhost/api/panta/markets/create/quote"), ctx("markets/create/quote"));
    expect(r.status).toBe(405);
    expect((await post("markets/create/sell", {})).status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("strict request validation before forwarding", () => {
  it("valid quote is forwarded with the server key only; account ids are stripped from the response", async () => {
    const f = mockUpstream({ ...FX.breaking.quote, userId: "usr_secret", apiKeyId: "key_secret" });
    const res = await post("markets/create/quote", quoteBody(), freshIp(), { "x-api-key": "pk_live_attacker", authorization: "Bearer x" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.createId).toBe(FX.breaking.quote.createId);
    expect(json).not.toHaveProperty("userId");
    expect(json).not.toHaveProperty("apiKeyId");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/markets\/create\/quote\/$/);
    const h = new Headers(init.headers);
    expect(h.get("x-api-key")).toBe("pk_test_vitest_dummy");
    expect(h.get("authorization")).toBeNull();
    expect(JSON.parse(String(init.body))).toEqual(quoteBody());
  });
  const bad: [string, Record<string, unknown>][] = [
    ["oracle (not exposed)", { oracle: "https://x.example" }],
    ["paymentUsdc (client-set amount)", { paymentUsdc: "1" }],
    ["unknown key", { extra: 1 }],
    ["bad wallet", { wallet: "not-a-wallet" }],
    ["non-https source", { sourcesOfTruth: ["http://example.com"] }],
    ["too many sources", { sourcesOfTruth: Array.from({ length: 21 }, (_, i) => `https://s${i}.example.com`) }],
    ["empty sources", { sourcesOfTruth: [] }],
    ["unknown category", { category: "memes" }],
    ["bad market type", { marketType: "flash" }],
    ["string timestamps", { startTime: "1791274463" }],
    ["float timestamp", { endTime: 1791360863.5 }],
    ["chronology", { endTime: 1, startTime: 2 }],
    ["imageUrl off-host", { imageUrl: "https://evil.example/x.png" }],
    ["imageUrl internal", { imageUrl: "http://169.254.169.254/latest" }],
    ["eventInProgress on standard", { marketType: "standard", eventInProgress: true }],
    ["eventInProgress not boolean", { eventInProgress: "yes" }],
    ["question too long", { question: "x".repeat(513) }],
    ["region too long", { region: "x".repeat(65) }],
  ];
  for (const [label, patch] of bad) {
    it(`quote rejected: ${label}`, async () => {
      const f = mockUpstream();
      const res = await post("markets/create/quote", { ...quoteBody(), ...patch });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("INVALID_REQUEST");
      expect(f).not.toHaveBeenCalled();
    });
  }
  it("build: strict createId + wallet; extra keys rejected", async () => {
    const f = mockUpstream(FX.breaking.build);
    expect((await post("markets/create/build", { createId: FX.breaking.quote.createId, wallet: FX.breaking.request.wallet })).status).toBe(200);
    expect((await post("markets/create/build", { createId: "cr_../../x", wallet: FX.breaking.request.wallet })).status).toBe(400);
    expect((await post("markets/create/build", { createId: FX.breaking.quote.createId })).status).toBe(400);
    expect((await post("markets/create/build", { createId: FX.breaking.quote.createId, wallet: FX.breaking.request.wallet, paymentUsdc: "1" })).status).toBe(400);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("register: strict createId + base58 signature", async () => {
    const f = mockUpstream();
    const sig = "5VEJv1R" + "1".repeat(80);
    expect((await post("markets/register", { createId: FX.breaking.quote.createId, signature: sig })).status).toBe(200);
    expect((await post("markets/register", { createId: FX.breaking.quote.createId, signature: "0OIl" + sig.slice(4) })).status).toBe(400);
    expect((await post("markets/register", { createId: "cr_x", signature: sig })).status).toBe(400);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("image-upload: only an empty JSON object is forwarded (no bytes, no URLs)", async () => {
    const f = mockUpstream();
    expect((await post("markets/create/image-upload", {})).status).toBe(200);
    expect((await post("markets/create/image-upload", { uploadUrl: "https://evil.example" })).status).toBe(400);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("create rate limits", () => {
  it("7th build from one IP within a minute is 429 and never reaches Panta", async () => {
    const f = mockUpstream(FX.breaking.build);
    const ip = freshIp();
    const body = { createId: FX.breaking.quote.createId, wallet: FX.breaking.request.wallet };
    for (let i = 0; i < 6; i++) expect((await post("markets/create/build", body, ip)).status).toBe(200);
    const limited = await post("markets/create/build", body, ip);
    expect(limited.status).toBe(429);
    expect(f).toHaveBeenCalledTimes(6);
    // separate bucket: primary build still works for the same IP
    expect((await post("primaryorderbuild", {}, ip)).status).toBe(200);
  });
});

describe("CSP upload endpoint stays in sync", () => {
  it("CSP connect-src entry equals the pinned upload URL the grant parser accepts", async () => {
    const { CREATE_IMAGE_UPLOAD_ENDPOINT } = await import("@/lib/security-headers");
    const { CLOUDINARY_UPLOAD_URL } = await import("@/lib/panta/create-rules");
    expect(CREATE_IMAGE_UPLOAD_ENDPOINT).toBe(CLOUDINARY_UPLOAD_URL);
    expect(FX.imageUpload.uploadUrl).toBe(CLOUDINARY_UPLOAD_URL);
  });
});
