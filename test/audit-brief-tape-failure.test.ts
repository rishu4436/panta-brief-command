/**
 * Audit (Oct 2026 test pass): /api/brief when Panta's tape endpoint fails.
 * An unavailable tape must not be presented as "no recent prints".
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const MARKET = "5cyMGUVDcToJ8ws5V1sKkGnzthLrLTsqEjo3Pa2HNU8v";
let POST: (req: NextRequest) => Promise<Response>;

const detail = {
  marketId: MARKET,
  title: "Audit market",
  phase: "primary",
  status: "primary",
  yesPrice: "0.50",
  noPrice: "0.50",
  resolutionTime: Math.floor(Date.now() / 1000) + 86_400,
};

beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/trades/")) {
        return new Response(JSON.stringify({ code: "UPSTREAM_ERROR" }), { status: 500 });
      }
      return new Response(JSON.stringify(detail), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  POST = (await import("@/app/api/brief/route")).POST;
});
afterAll(() => vi.unstubAllGlobals());

describe("audit: brief with tape unavailable", () => {
  it("fails with an upstream error instead of a brief claiming the tape is empty", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" },
        body: JSON.stringify({ marketId: MARKET, mode: "flow" }),
      }),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("UPSTREAM_ERROR");
    expect(body.signals).toBeUndefined();
  });
});
