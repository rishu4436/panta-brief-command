/**
 * /api/rpc relay: method allowlist, batch cap, body limit, per-IP rate limit,
 * not-configured 503, upstream timeout / error redaction, and the client
 * pointing at the relay with HTTP-polling confirmation (no websocket).
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clientRpcEndpoint, RPC_RELAY_PATH, serverRpcUrl } from "@/lib/rpc";
import {
  checkSimulateParams,
  parseRpcBody,
  redactUpstream,
  RPC_MAX_BATCH,
  RPC_MAX_BODY_BYTES,
  RPC_METHODS,
  RPC_RATE_LIMIT,
  rpcUpstream,
} from "@/lib/rpc-relay";
import { confirmSignature } from "@/lib/solana";
import type { Connection } from "@solana/web3.js";

const UPSTREAM = "https://mainnet.rpc-provider.example/?api-key=SECRETKEY123456";
type Handler = (req: NextRequest) => Promise<Response>;
let POST: Handler;
beforeAll(async () => {
  POST = (await import("@/app/api/rpc/route")).POST as unknown as Handler;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

let ipSeq = 0;
const freshIp = () => `198.51.100.${++ipSeq}`;
const call = (method: string, id: number | string = 1, params: unknown[] = []) => ({ jsonrpc: "2.0", id, method, params });
const send = (body: unknown, ip = freshIp(), raw?: string) =>
  POST(
    new NextRequest("http://localhost/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": ip },
      body: raw ?? JSON.stringify(body),
    }),
  );
function upstream(impl?: (body: unknown) => Response | Promise<Response>) {
  const f = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (impl) return impl(body);
    const one = (c: { id: unknown }) => ({ jsonrpc: "2.0", id: c.id, result: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" });
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", f);
  return f;
}
const configured = () => vi.stubEnv("SOLANA_RPC_URL", UPSTREAM);

describe("method allowlist (derived from the client code)", () => {
  it("is exactly the calls the app makes", () => {
    expect([...RPC_METHODS].sort()).toEqual(
      // Stage B (deliberate relay change): simulateTransaction, strictly scoped by checkSimulateParams.
      ["getAccountInfo", "getBlockHeight", "getGenesisHash", "getLatestBlockhash", "getSignatureStatuses", "getTokenAccountsByOwner", "sendTransaction", "simulateTransaction"].sort(),
    );
  });
  it("rejects disallowed / malformed calls before reaching upstream", async () => {
    configured();
    const f = upstream();
    for (const m of ["getProgramAccounts", "requestAirdrop", "getSignaturesForAddress", "getTransaction", "__proto__"]) {
      const r = await send(call(m, 7));
      expect(r.status).toBe(403);
      const j = await r.json();
      expect(j.error.code).toBe(-32601);
      expect(j.id).toBe(7);
    }
    // one bad method poisons the whole batch
    expect((await send([call("getGenesisHash"), call("getProgramAccounts", 2)])).status).toBe(403);
    expect((await send({ id: 1, method: "getGenesisHash" })).status).toBe(400); // no jsonrpc
    expect((await send(null, undefined, "{nope")).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it("allowed call is forwarded to SOLANA_RPC_URL and returned", async () => {
    configured();
    const f = upstream();
    const r = await send(call("getGenesisHash"));
    expect(r.status).toBe(200);
    expect((await r.json()).result).toBe("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
    expect(f.mock.calls[0][0]).toBe(UPSTREAM);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-ratelimit-limit")).toBe(String(RPC_RATE_LIMIT));
  });
});

describe("batch cap + body limit", () => {
  it(`accepts up to ${RPC_MAX_BATCH}, rejects more and empty batches`, async () => {
    configured();
    const f = upstream();
    const ok = await send(Array.from({ length: RPC_MAX_BATCH }, (_, i) => call("getBlockHeight", i)));
    expect(ok.status).toBe(200);
    expect((await ok.json()).length).toBe(RPC_MAX_BATCH);
    expect((await send(Array.from({ length: RPC_MAX_BATCH + 1 }, (_, i) => call("getBlockHeight", i)))).status).toBe(400);
    expect((await send([])).status).toBe(400);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("rejects bodies over the limit with 413", async () => {
    configured();
    const f = upstream();
    const big = call("sendTransaction", 1, ["A".repeat(RPC_MAX_BODY_BYTES + 10)]);
    expect((await send(big)).status).toBe(413);
    expect(f).not.toHaveBeenCalled();
  });
  it("parseRpcBody unit", () => {
    expect(parseRpcBody(call("getGenesisHash")).ok).toBe(true);
    expect(parseRpcBody({ jsonrpc: "2.0", id: {}, method: "getGenesisHash" }).ok).toBe(false);
  });
});

describe("per-IP rate limit", () => {
  it("generous enough for a trade + 90 s of confirmation polling", () => {
    // ~10 setup calls + 45 status polls + 15 block-height checks, ×3 for retries
    expect(RPC_RATE_LIMIT).toBeGreaterThanOrEqual(3 * (10 + 45 + 15));
  });
  it(`429 after ${RPC_RATE_LIMIT}/min from one IP, without calling upstream; other IPs unaffected`, async () => {
    configured();
    const f = upstream();
    const ip = freshIp();
    for (let i = 0; i < RPC_RATE_LIMIT; i++) expect((await send(call("getBlockHeight", i), ip)).status).toBe(200);
    const n = f.mock.calls.length;
    const limited = await send(call("getBlockHeight"), ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(f.mock.calls.length).toBe(n);
    expect((await send(call("getBlockHeight"), freshIp())).status).toBe(200);
  });
});

describe("not configured", () => {
  it("503 RPC_NOT_CONFIGURED in production with no SOLANA_RPC_URL — no public fallback, even if NEXT_PUBLIC_DEFAULT_RPC is set", async () => {
    vi.stubEnv("SOLANA_RPC_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_RPC", "https://api.mainnet-beta.solana.com");
    const f = upstream();
    const r = await send(call("getGenesisHash"));
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("RPC_NOT_CONFIGURED");
    expect(f).not.toHaveBeenCalled();
  });
  it("rpcUpstream: private env first; NEXT_PUBLIC_DEFAULT_RPC only outside production; bad URLs refused", () => {
    expect(rpcUpstream({ SOLANA_RPC_URL: UPSTREAM, NODE_ENV: "production" })).toEqual({ url: UPSTREAM });
    expect(rpcUpstream({ NODE_ENV: "production", NEXT_PUBLIC_DEFAULT_RPC: "https://a.example" })).toEqual({ error: "RPC_NOT_CONFIGURED" });
    expect(rpcUpstream({ NODE_ENV: "development", NEXT_PUBLIC_DEFAULT_RPC: "https://a.example" })).toEqual({ url: "https://a.example" });
    expect(rpcUpstream({ SOLANA_RPC_URL: "javascript:alert(1)", NODE_ENV: "production" })).toEqual({ error: "RPC_NOT_CONFIGURED" });
  });
});

describe("upstream failures never leak the URL / key", () => {
  const leaks = (s: string) => /SECRETKEY123456|rpc-provider\.example|api-key=S/.test(s);
  it("timeout → 504 generic", async () => {
    configured();
    upstream(() => {
      throw Object.assign(new Error(`timeout fetching ${UPSTREAM}`), { name: "TimeoutError" });
    });
    const r = await send(call("getGenesisHash"));
    expect(r.status).toBe(504);
    const t = await r.text();
    expect(t).toContain("RPC_UPSTREAM_TIMEOUT");
    expect(leaks(t)).toBe(false);
  });
  it("network error → 502 generic", async () => {
    configured();
    upstream(() => {
      throw new TypeError(`fetch failed: ${UPSTREAM}`);
    });
    const r = await send(call("getGenesisHash"));
    expect(r.status).toBe(502);
    expect(leaks(await r.text())).toBe(false);
  });
  it("non-JSON / HTML provider error page → generic, body dropped", async () => {
    configured();
    upstream(() => new Response(`<html>401 invalid key for ${UPSTREAM}</html>`, { status: 401 }));
    const r = await send(call("getGenesisHash"));
    expect(r.status).toBe(502);
    const t = await r.text();
    expect(t).toContain("RPC_UPSTREAM_HTTP_401");
    expect(leaks(t)).toBe(false);
  });
  it("JSON-RPC error that mentions the URL/host/key is redacted (message kept)", async () => {
    configured();
    upstream(
      (b) =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: (b as { id: number }).id, error: { code: -32002, message: `Transaction simulation failed via ${UPSTREAM} (key SECRETKEY123456, host mainnet.rpc-provider.example)` } }),
          { status: 200 },
        ),
    );
    const r = await send(call("sendTransaction", 3, ["AQ=="]));
    expect(r.status).toBe(200);
    const t = await r.text();
    expect(leaks(t)).toBe(false);
    expect(JSON.parse(t).error.message).toContain("Transaction simulation failed");
  });
  it("redactUpstream unit", () => {
    expect(redactUpstream(`x ${UPSTREAM} y`, UPSTREAM)).toBe("x [rpc] y");
    expect(redactUpstream("api_key=zzz", UPSTREAM)).toBe("api-key=[redacted]");
  });
  it("the route never logs", () => {
    const src = readFileSync("src/app/api/rpc/route.ts", "utf8") + readFileSync("src/lib/rpc-relay.ts", "utf8");
    expect(src).not.toMatch(/console\./);
  });
});

describe("client config uses the relay", () => {
  it("absolute same-origin /api/rpc URL", () => {
    expect(RPC_RELAY_PATH).toBe("/api/rpc");
    expect(clientRpcEndpoint("https://briefcommand.vercel.app")).toBe("https://briefcommand.vercel.app/api/rpc");
    expect(clientRpcEndpoint("http://localhost:3000/")).toBe("http://localhost:3000/api/rpc");
  });
  it("Providers + all client code never read NEXT_PUBLIC_DEFAULT_RPC / SOLANA_RPC_URL", () => {
    const p = readFileSync("src/components/Providers.tsx", "utf8");
    expect(p).toMatch(/clientRpcEndpoint\(typeof window !== "undefined" \? window\.location\.origin/);
    for (const f of ["src/components/Providers.tsx", "src/lib/rpc.ts", "src/lib/solana.ts", "src/lib/network.ts", "src/lib/security-headers.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/process\.env\.NEXT_PUBLIC_DEFAULT_RPC|process\.env\.SOLANA_RPC_URL/);
    }
  });
  it("server discovery reads prefer private env", () => {
    expect(serverRpcUrl({ SOLANA_RPC_URL: UPSTREAM })).toBe(UPSTREAM);
    expect(serverRpcUrl({ PANTA_DISCOVERY_RPC_URL: "https://d.example", SOLANA_RPC_URL: UPSTREAM })).toBe("https://d.example");
  });
  it("server discovery reads never fall back to the public RPC in production", () => {
    expect(serverRpcUrl({ NODE_ENV: "production" })).toBeNull();
    expect(serverRpcUrl({ NODE_ENV: "production", NEXT_PUBLIC_DEFAULT_RPC: "https://api.mainnet-beta.solana.com" })).toBeNull();
    expect(serverRpcUrl({ NODE_ENV: "production", SOLANA_RPC_URL: UPSTREAM })).toBe(UPSTREAM);
    expect(serverRpcUrl({ NODE_ENV: "development" })).toBe("https://api.mainnet-beta.solana.com");
  });
});

describe("confirmation is HTTP polling (no websocket subscription)", () => {
  type St = { err: unknown; confirmationStatus?: string } | null;
  function fakeConn(statuses: St[], heights: number[]) {
    let si = 0;
    let hi = 0;
    const c = {
      getSignatureStatuses: vi.fn(async () => ({ value: [statuses[Math.min(si++, statuses.length - 1)]] })),
      getBlockHeight: vi.fn(async () => heights[Math.min(hi++, heights.length - 1)]),
      confirmTransaction: vi.fn(),
      onSignature: vi.fn(),
    };
    return c;
  }
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => void (t += ms) };
  };
  it("confirmed after a few polls; never subscribes", async () => {
    const c = fakeConn([null, { err: null, confirmationStatus: "processed" }, { err: null, confirmationStatus: "confirmed" }], [100]);
    const r = await confirmSignature(c as unknown as Connection, "sig", "bh", 200, clock());
    expect(r).toEqual({ status: "confirmed" });
    expect(c.confirmTransaction).not.toHaveBeenCalled();
    expect(c.onSignature).not.toHaveBeenCalled();
  });
  it("on-chain err → failed", async () => {
    const c = fakeConn([{ err: { InstructionError: [0, "Custom"] } }], [100]);
    expect((await confirmSignature(c as unknown as Connection, "s", "b", 200, clock())).status).toBe("failed");
  });
  it("block height past lastValidBlockHeight → expired (after a final status check)", async () => {
    const c = fakeConn([null], [300]);
    const r = await confirmSignature(c as unknown as Connection, "s", "b", 200, clock());
    expect(r.status).toBe("expired");
    expect(c.getSignatureStatuses).toHaveBeenCalledTimes(2);
  });
  it("still unconfirmed at the 90 s ceiling → pending; ~2 s cadence", async () => {
    const c = fakeConn([null], [100]);
    const r = await confirmSignature(c as unknown as Connection, "s", "b", 200, clock());
    expect(r.status).toBe("pending");
    expect(r.status === "pending" && r.message).toMatch(/90s/);
    expect(c.getSignatureStatuses.mock.calls.length).toBeGreaterThanOrEqual(40);
    expect(c.getSignatureStatuses.mock.calls.length).toBeLessThanOrEqual(46);
  });
  it("transient RPC errors are retried; persistent ones end pending with the error", async () => {
    let n = 0;
    const flaky = {
      getSignatureStatuses: vi.fn(async () => {
        if (n++ < 2) throw new Error("429");
        return { value: [{ err: null, confirmationStatus: "finalized" }] };
      }),
      getBlockHeight: vi.fn(async () => 100),
    };
    expect(await confirmSignature(flaky as unknown as Connection, "s", "b", 200, clock())).toEqual({ status: "confirmed" });
    const dead = { getSignatureStatuses: vi.fn(async () => { throw new Error("relay down"); }), getBlockHeight: vi.fn() };
    const r = await confirmSignature(dead as unknown as Connection, "s", "b", 200, clock());
    expect(r.status === "pending" && r.message).toMatch(/RPC error: relay down/);
  });
});

describe("simulateTransaction scoping (Stage B relay change)", () => {
  const TX = Buffer.alloc(600, 7).toString("base64");
  const W = "41Vs8iTkADCDDBb2KxPjpRbJwpN8WR6gHnMCDKV4e5Yz";
  const ok = { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed", innerInstructions: true, accounts: { encoding: "base64", addresses: [W] } };
  const sim = (params: unknown) => ({ jsonrpc: "2.0", id: 3, method: "simulateTransaction", params });
  it("accepts exactly the app's parameter shape", () => {
    expect(checkSimulateParams([TX, ok])).toBeNull();
    expect(parseRpcBody(sim([TX, ok])).ok).toBe(true);
  });
  it.each([
    ["missing config", [TX]],
    ["extra param", [TX, ok, 1]],
    ["non-base64 tx", ["!".repeat(200), ok]],
    ["tiny tx", ["AAAA", ok]],
    ["oversize tx", [Buffer.alloc(1300, 1).toString("base64"), ok]],
    ["sigVerify true", [TX, { ...ok, sigVerify: true }]],
    ["replaceRecentBlockhash true", [TX, { ...ok, replaceRecentBlockhash: true }]],
    ["base58 encoding", [TX, { ...ok, encoding: "base58" }]],
    ["unknown key", [TX, { ...ok, foo: 1 }]],
    ["bad commitment", [TX, { ...ok, commitment: "max" }]],
    ["too many accounts", [TX, { ...ok, accounts: { encoding: "base64", addresses: [W, W, W, W, W] } }]],
    ["bad account key", [TX, { ...ok, accounts: { encoding: "base64", addresses: ["not-a-key"] } }]],
    ["accounts extra key", [TX, { ...ok, accounts: { encoding: "base64", addresses: [W], x: 1 } }]],
    ["accounts jsonParsed", [TX, { ...ok, accounts: { encoding: "jsonParsed", addresses: [W] } }]],
  ])("rejects %s with 400 before upstream", (_n, params) => {
    expect(checkSimulateParams(params)).not.toBeNull();
    const r = parseRpcBody(sim(params));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.code).toBe(-32602);
    }
  });
});
