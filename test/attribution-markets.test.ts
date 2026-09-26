import { describe, expect, it, vi } from "vitest";
import { attributionFromReport, parseAccountTrades, parseTradeReport } from "@/lib/panta/attribution";
import { isAttributableClaim } from "@/lib/panta/claims";
import type { Market } from "@/lib/panta/domain";
import {
  fetchMarketWithRetry,
  isPartialMarket,
  mergeMarket,
  parseMarket,
  parseMarketPage,
  preferFuller,
} from "@/lib/panta/markets";

const ID = "3wdVRLDiMeuWRjGcFq2FZgAyCLhswTwNSKEHgNFRSZNB";

describe("attribution status mapping", () => {
  it("processed means attributed", () => {
    expect(attributionFromReport("processed")).toBe("attributed");
    expect(attributionFromReport("PROCESSED")).toBe("attributed");
  });

  it("anything else is only reported", () => {
    for (const s of ["pending", "queued", "received", "", null, undefined, "failed"]) {
      expect(attributionFromReport(s)).toBe("reported");
    }
  });

  it("parseTradeReport tolerates garbage and keeps the signature", () => {
    expect(parseTradeReport(null, "sig1")).toMatchObject({ signature: "sig1", status: "" });
    expect(parseTradeReport({ status: "Processed", extra: 1 }, "sig1").status).toBe("processed");
  });

  it("only win claims are attributable", () => {
    expect(isAttributableClaim("win")).toBe(true);
    expect(isAttributableClaim("creator-fees")).toBe(false);
  });

  it("account trades: rows without a signature are dropped, amounts parsed", () => {
    const out = parseAccountTrades({
      items: [{ signature: "a", amountUsdcBase: "2500000", kind: "buy" }, { amountUsdc: "1" }],
    });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].amountUsdc).toBe(2.5);
  });
});

describe("markets adapter (zod boundary)", () => {
  it("unknown API fields pass the schema (loose) but stay out of the canonical Market", () => {
    const m = parseMarket({ marketId: ID, title: "T", phase: "PRIMARY", futureField: 42 });
    expect(m).not.toBeNull();
    expect(m?.title).toBe("T");
    expect(m?.phase).toBe("primary");
    expect((m as unknown as Record<string, unknown>).futureField).toBeUndefined();
  });

  it("unknown phase values are kept, not rejected", () => {
    expect(parseMarket({ marketId: ID, phase: "paused" })?.phase).toBe("paused");
  });

  it("nullable / wrongly typed fields degrade instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = parseMarket({ marketId: ID, title: null, yesPrice: { bad: true }, endTime: "soon" });
    expect(m).not.toBeNull();
    expect(m?.title ?? "").toBe("");
    warn.mockRestore();
  });

  it("a response without a marketId parses to null, never throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseMarket({ title: "x" })).toBeNull();
    expect(parseMarket("<html>502</html>")).toBeNull();
    warn.mockRestore();
  });

  it("market page drops rows without an id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const page = parseMarketPage({ items: [{ marketId: ID }, { title: "no id" }], nextCursor: null });
    expect(page.items.map((m) => m.marketId)).toEqual([ID]);
    warn.mockRestore();
  });

  it("partial detail never overwrites a fuller cached record", () => {
    const full = parseMarket({ marketId: ID, title: "Full", yesPrice: "0.6", noPrice: "0.4", phase: "secondary" })!;
    const partial = parseMarket({ marketId: ID, phase: "primary" })!;
    expect(isPartialMarket(partial)).toBe(true);
    expect(preferFuller(full, partial).title).toBe("Full");
    const merged = mergeMarket(full, partial);
    expect(merged.title).toBe("Full");
    expect(merged.phase).toBe("secondary"); // partial detail's phase is not trusted
  });

  it("retries a partial detail up to twice, then marks it partial", async () => {
    vi.useFakeTimers();
    const getRaw = vi.fn(async () => ({ marketId: ID, phase: "primary" }));
    const p = fetchMarketWithRetry(getRaw);
    await vi.runAllTimersAsync();
    const m = await p;
    vi.useRealTimers();
    expect(getRaw).toHaveBeenCalledTimes(3);
    expect(m?.partial).toBe(true);
  });

  it("stops retrying once a full record arrives", async () => {
    vi.useFakeTimers();
    const responses = [{ marketId: ID }, { marketId: ID, title: "Now full", yesPrice: "0.5" }];
    const getRaw = vi.fn(async () => responses.shift());
    const p = fetchMarketWithRetry(getRaw);
    await vi.runAllTimersAsync();
    const m = (await p) as Market;
    vi.useRealTimers();
    expect(getRaw).toHaveBeenCalledTimes(2);
    expect(m.title).toBe("Now full");
    expect(m.partial).toBeFalsy();
  });
});
