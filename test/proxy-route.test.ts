import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type Handler = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;
let GET: Handler;
let POST: Handler;

const MARKET = "3wdVRLDiMeuWRjGcFq2FZgAyCLhswTwNSKEHgNFRSZNB";

beforeAll(async () => {
  process.env.PANTA_API_KEY = "pk_test_vitest_dummy";
  const mod = await import("@/app/api/panta/[...path]/route");
  GET = mod.GET as unknown as Handler;
  POST = mod.POST as unknown as Handler;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });

function mockUpstream(body: unknown = { items: [], nextCursor: null }, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("/api/panta proxy", () => {
  it("allowed route returns 200 with upstream mocked", async () => {
    const fetchMock = mockUpstream();
    const res = await GET(new NextRequest("http://localhost/api/panta/markets?limit=5&evil=1"), ctx(["markets"]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/markets/?limit=5");
    expect(url).not.toContain("evil"); // only documented query keys are forwarded
  });

  it("market detail route is allowed", async () => {
    mockUpstream({ marketId: MARKET });
    const res = await GET(new NextRequest(`http://localhost/api/panta/markets/${MARKET}`), ctx(["markets", MARKET]));
    expect(res.status).toBe(200);
  });

  it("unknown route returns 403 without calling upstream", async () => {
    const fetchMock = mockUpstream();
    const res = await GET(new NextRequest("http://localhost/api/panta/admin/keys"), ctx(["admin", "keys"]));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("ROUTE_NOT_ALLOWED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wrong method returns 405 with Allow header", async () => {
    const fetchMock = mockUpstream();
    const res = await POST(
      new NextRequest("http://localhost/api/panta/markets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      ctx(["markets"]),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied x-api-key and sends only the server key", async () => {
    const fetchMock = mockUpstream();
    const res = await GET(
      new NextRequest("http://localhost/api/panta/markets", {
        headers: { "x-api-key": "pk_live_attacker", authorization: "Bearer attacker" },
      }),
      ctx(["markets"]),
    );
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("x-api-key")).toBe("pk_test_vitest_dummy");
    expect(headers.get("authorization")).toBeNull();
  });

  it("encoded path returns 400", async () => {
    const fetchMock = mockUpstream();
    const res = await GET(
      new NextRequest("http://localhost/api/panta/markets%2F..%2Fadmin"),
      ctx(["markets/../admin"]),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_PATH");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("oversized body returns 413", async () => {
    const fetchMock = mockUpstream();
    const big = JSON.stringify({ wallet: "x".repeat(20 * 1024) });
    const res = await POST(
      new NextRequest("http://localhost/api/panta/primaryorderquote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: big,
      }),
      ctx(["primaryorderquote"]),
    );
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("declared oversized content-length is rejected before reading", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/panta/trades", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(1024 * 1024) },
        body: "{}",
      }),
      ctx(["trades"]),
    );
    expect(res.status).toBe(413);
  });
});
