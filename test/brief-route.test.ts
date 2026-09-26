import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { BRIEF_RATE_LIMIT } from "@/lib/brief-modes";

let POST: (req: NextRequest) => Promise<Response>;
const MARKET = "3wdVRLDiMeuWRjGcFq2FZgAyCLhswTwNSKEHgNFRSZNB";

beforeAll(async () => {
  // Validation must reject before any upstream call.
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("upstream must not be called in validation tests");
  }));
  POST = (await import("@/app/api/brief/route")).POST;
});

let ipSeq = 0;
function req(body: unknown, ip = `10.0.0.${++ipSeq}`) {
  return new NextRequest("http://localhost/api/brief", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("/api/brief validation", () => {
  it("extra fields are rejected with 400", async () => {
    const res = await POST(req({ marketId: MARKET, mode: "desk", tape: [{ side: "yes" }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("UNEXPECTED_FIELDS");
  });

  it("bad mode is rejected with 400", async () => {
    const res = await POST(req({ marketId: MARKET, mode: "moon" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_MODE");
  });

  it("bad market id is rejected with 400", async () => {
    const res = await POST(req({ marketId: "../../etc", mode: "desk" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_MARKET_ID");
  });

  it(`rate limit: request ${BRIEF_RATE_LIMIT + 1} in a minute from one IP gets 429 + Retry-After`, async () => {
    expect(BRIEF_RATE_LIMIT).toBe(20);
    const ip = "203.0.113.7";
    for (let i = 0; i < BRIEF_RATE_LIMIT; i++) {
      const res = await POST(req({ marketId: MARKET, mode: "moon" }, ip));
      expect(res.status).toBe(400);
    }
    const res = await POST(req({ marketId: MARKET, mode: "moon" }, ip));
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("RATE_LIMITED");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another IP is unaffected.
    expect((await POST(req({ marketId: MARKET, mode: "moon" }, "203.0.113.8"))).status).toBe(400);
  });
});
