/**
 * Phase 9D: preview (and any non-production Vercel) deployments are read-only on
 * the server. Panta POST routes and Solana send/simulate are refused with
 * PREVIEW_READ_ONLY before any upstream call; production behaviour is unchanged.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deploymentMode, isReadOnlyDeployment } from "@/lib/deploy-env";
import { PROXY_ROUTES, READ_ONLY_PROXY_ROUTE_IDS, allowedInReadOnly } from "@/lib/panta/routes";
import { parseRpcBody, RPC_METHODS, RPC_WRITE_METHODS } from "@/lib/rpc-relay";

type ProxyHandler = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;
type RpcHandler = (req: NextRequest) => Promise<Response>;
let GET: ProxyHandler;
let POST: ProxyHandler;
let RPC: RpcHandler;

const MARKET = "3wdVRLDiMeuWRjGcFq2FZgAyCLhswTwNSKEHgNFRSZNB";
const WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

/** One concrete path per proxy route id. */
const PATHS: Record<string, string> = {
  "markets.list": "markets",
  "markets.detail": `markets/${MARKET}`,
  "markets.trades": `markets/${MARKET}/trades`,
  categories: "categories",
  positions: "positions",
  "account.trades": "account/trades",
  "primary.quote": "primaryorderquote",
  "primary.build": "primaryorderbuild",
  "primary.submit": "primaryordersubmit",
  "primary.verify": "primaryorderverify",
  "trades.report": "trades",
  "claim.win.build": "claim/build",
  "claim.creatorFees.build": "claim/creator-fees/build",
  "create.imageUpload": "markets/create/image-upload",
  "create.quote": "markets/create/quote",
  "create.build": "markets/create/build",
  "create.register": "markets/register",
};
const WRITE_IDS = PROXY_ROUTES.filter((r) => r.methods.includes("POST")).map((r) => r.id);
const READ_IDS = PROXY_ROUTES.filter((r) => r.methods.every((m) => m === "GET")).map((r) => r.id);

let ipN = 0;
const ip = () => `198.51.100.${(ipN++ % 250) + 1}`;
const ctx = (p: string) => ({ params: Promise.resolve({ path: p.split("/") }) });

function mockUpstream(body: unknown = { ok: true }) {
  const f = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
}

function setEnv(mode: "preview" | "production" | "development" | "local" | "vercel-missing" | "odd") {
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_URL", "");
  vi.stubEnv("APP_READ_ONLY", "");
  if (mode === "preview" || mode === "production" || mode === "development") {
    vi.stubEnv("VERCEL_ENV", mode);
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "briefcommand-test.vercel.app");
  } else if (mode === "vercel-missing") {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_URL", "briefcommand-test.vercel.app");
  } else if (mode === "odd") {
    vi.stubEnv("VERCEL_ENV", "staging");
  }
}

const post = (p: string, body: unknown = {}) =>
  POST(new NextRequest(`http://localhost/api/panta/${p}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify(body) }), ctx(p));
const get = (p: string) => GET(new NextRequest(`http://localhost/api/panta/${p}${p === "positions" ? `?wallet=${WALLET}` : ""}`, { headers: { "x-forwarded-for": ip() } }), ctx(p));
const rpc = (body: unknown) =>
  RPC(new NextRequest("http://localhost/api/rpc", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify(body) }));

beforeAll(async () => {
  process.env.PANTA_API_KEY = "pk_test_vitest_dummy";
  const proxy = await import("@/app/api/panta/[...path]/route");
  GET = proxy.GET as unknown as ProxyHandler;
  POST = proxy.POST as unknown as ProxyHandler;
  RPC = (await import("@/app/api/rpc/route")).POST as unknown as RpcHandler;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deployment mode (server-side, from VERCEL_ENV)", () => {
  it("production is full; preview, development, unknown values and on-Vercel-without-VERCEL_ENV are read-only; local is unchanged", () => {
    expect(deploymentMode({ VERCEL_ENV: "production", VERCEL: "1", VERCEL_URL: "x.vercel.app" })).toEqual({ env: "production", readOnly: false });
    expect(deploymentMode({ VERCEL_ENV: "preview" })).toEqual({ env: "preview", readOnly: true });
    expect(deploymentMode({ VERCEL_ENV: "development" })).toEqual({ env: "development", readOnly: true });
    expect(deploymentMode({ VERCEL_ENV: "staging" })).toEqual({ env: "other", readOnly: true });
    expect(deploymentMode({ VERCEL_ENV: " Preview " }).readOnly).toBe(true);
    expect(deploymentMode({ VERCEL: "1", VERCEL_URL: "x.vercel.app" })).toEqual({ env: "other", readOnly: true });
    expect(deploymentMode({})).toEqual({ env: "local", readOnly: false });
    expect(deploymentMode({ VERCEL: "1", VERCEL_URL: "" })).toEqual({ env: "local", readOnly: false }); // pulled env file
    expect(deploymentMode({ APP_READ_ONLY: "1" }).readOnly).toBe(true);
    expect(deploymentMode({ VERCEL_ENV: "preview", APP_READ_ONLY: "0" }).readOnly).toBe(true); // nothing un-restricts
  });

  it("the read-only allowlist is exactly the GET-only proxy routes", () => {
    expect([...READ_ONLY_PROXY_ROUTE_IDS].sort()).toEqual([...READ_IDS].sort());
    for (const r of PROXY_ROUTES) {
      expect(allowedInReadOnly(r, "POST")).toBe(false);
      expect(allowedInReadOnly(r, "GET")).toBe(READ_IDS.includes(r.id));
    }
    expect(Object.keys(PATHS).sort()).toEqual(PROXY_ROUTES.map((r) => r.id).sort()); // table covers every route
  });

  it("RPC write methods cover every transaction-landing method in the relay allowlist", () => {
    expect(RPC_WRITE_METHODS.has("sendTransaction")).toBe(true);
    expect(RPC_WRITE_METHODS.has("simulateTransaction")).toBe(true);
    expect(RPC_WRITE_METHODS.has("sendRawTransaction")).toBe(true);
    const reads = [...RPC_METHODS].filter((m) => !RPC_WRITE_METHODS.has(m));
    expect(reads.sort()).toEqual(["getAccountInfo", "getBlockHeight", "getGenesisHash", "getLatestBlockhash", "getSignatureStatuses", "getTokenAccountsByOwner"]);
  });
});

describe("Panta proxy in preview", () => {
  for (const id of WRITE_IDS) {
    it(`POST ${id} → 403 PREVIEW_READ_ONLY, no upstream call`, async () => {
      setEnv("preview");
      const f = mockUpstream();
      const res = await post(PATHS[id]);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("PREVIEW_READ_ONLY");
      expect(f).not.toHaveBeenCalled();
    });
  }

  for (const id of READ_IDS) {
    it(`GET ${id} is still forwarded`, async () => {
      setEnv("preview");
      const f = mockUpstream();
      const res = await get(PATHS[id]);
      expect(res.status).toBe(200);
      expect(f).toHaveBeenCalledTimes(1);
      expect((f.mock.calls[0][1] as RequestInit).method).toBe("GET");
    });
  }

  it("development, unknown VERCEL_ENV and on-Vercel-without-VERCEL_ENV are restricted the same way", async () => {
    for (const m of ["development", "odd", "vercel-missing"] as const) {
      setEnv(m);
      const f = mockUpstream();
      const res = await post(PATHS["primary.build"]);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("PREVIEW_READ_ONLY");
      expect(f).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });

  it("unknown routes still answer ROUTE_NOT_ALLOWED (the read-only check doesn't widen anything)", async () => {
    setEnv("preview");
    const f = mockUpstream();
    const res = await get("account/keys");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("ROUTE_NOT_ALLOWED");
    expect(f).not.toHaveBeenCalled();
  });
});

describe("Panta proxy in production and locally (unchanged)", () => {
  for (const mode of ["production", "local"] as const) {
    for (const id of WRITE_IDS) {
      it(`${mode}: POST ${id} is not refused as read-only`, async () => {
        setEnv(mode);
        mockUpstream();
        const res = await post(PATHS[id]);
        const body = await res.json();
        expect(body.code).not.toBe("PREVIEW_READ_ONLY");
        // Plain write routes reach upstream (mocked 200); create routes validate their body first (400 on {}).
        expect([200, 400]).toContain(res.status);
      });
    }
    it(`${mode}: GET reads forwarded`, async () => {
      setEnv(mode);
      const f = mockUpstream();
      expect((await get(PATHS["markets.list"])).status).toBe(200);
      expect(f).toHaveBeenCalledTimes(1);
    });
  }
});

describe("/api/rpc relay", () => {
  const SIM_TX = "A".repeat(200);
  const sim = { jsonrpc: "2.0", id: 3, method: "simulateTransaction", params: [SIM_TX, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false }] };
  const send = { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: ["AQID", { encoding: "base64" }] };

  it("preview: sendTransaction, sendRawTransaction and simulateTransaction → 403 PREVIEW_READ_ONLY, no upstream call", async () => {
    setEnv("preview");
    vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example.invalid/?api-key=dummy");
    const f = mockUpstream({ jsonrpc: "2.0", id: 1, result: "x" });
    for (const body of [send, { ...send, method: "sendRawTransaction" }, sim, [{ jsonrpc: "2.0", id: 9, method: "getGenesisHash" }, send]]) {
      const res = await rpc(body);
      expect(res.status).toBe(403);
      const j = await res.json();
      expect(j.code).toBe("PREVIEW_READ_ONLY");
      expect(j.error.message).toContain("PREVIEW_READ_ONLY");
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("preview: read methods are still relayed", async () => {
    setEnv("preview");
    vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example.invalid/?api-key=dummy");
    const f = mockUpstream({ jsonrpc: "2.0", id: 1, result: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" });
    for (const method of ["getGenesisHash", "getLatestBlockhash", "getBlockHeight"]) {
      const res = await rpc({ jsonrpc: "2.0", id: 1, method, params: [] });
      expect(res.status).toBe(200);
    }
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("production and local: sendTransaction and simulateTransaction are relayed as before", async () => {
    for (const mode of ["production", "local"] as const) {
      setEnv(mode);
      vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example.invalid/?api-key=dummy");
      const f = mockUpstream({ jsonrpc: "2.0", id: 1, result: "sig" });
      expect((await rpc(send)).status).toBe(200);
      expect((await rpc(sim)).status).toBe(200);
      expect(f).toHaveBeenCalledTimes(2);
      vi.unstubAllGlobals();
    }
  });

  it("parseRpcBody only refuses write methods when readOnly is set", () => {
    expect(parseRpcBody(send).ok).toBe(true);
    const r = parseRpcBody(send, { readOnly: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect([r.status, r.readOnly]).toEqual([403, true]);
    expect(parseRpcBody({ jsonrpc: "2.0", id: 1, method: "getGenesisHash" }, { readOnly: true }).ok).toBe(true);
    expect(isReadOnlyDeployment({ VERCEL_ENV: "production" })).toBe(false);
  });
});
