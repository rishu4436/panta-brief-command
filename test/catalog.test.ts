import { createHash } from "node:crypto";
import bs58 from "bs58";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EVENT_DISCRIMINATOR,
  EVENT_DISCRIMINATOR_B58,
  decodeEventAccount,
  formatUsdcBase,
} from "@/lib/panta/chain-events";
import {
  countLifecycles,
  filterCatalog,
  marketLifecycle,
  mergeCatalog,
  sortCatalog,
  withDetail,
} from "@/lib/panta/catalog";
import type { Market } from "@/lib/panta/domain";

const NOW = 1_790_000_000;

type EvOpts = {
  question?: string;
  rule?: string;
  sources?: string[];
  end?: number;
  ppe?: number;
  lastYes?: bigint;
  volume?: bigint;
  active?: bigint;
  graduated?: boolean;
  resolved?: boolean;
  cancelled?: boolean;
};

/** Serialize an `Event` account the way Anchor lays it out (borsh). */
function eventAccount(o: EvOpts = {}): Uint8Array {
  const parts: Buffer[] = [];
  const i64 = (n: number) => {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(n));
    parts.push(b);
  };
  const u64 = (n: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    parts.push(b);
  };
  const u128 = (n: bigint) => {
    u64(n & ((BigInt(1) << BigInt(64)) - BigInt(1)));
    u64(n >> BigInt(64));
  };
  const str = (s: string) => {
    const body = Buffer.from(s, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(body.length);
    parts.push(len, body);
  };
  const u8 = (n: number) => parts.push(Buffer.from([n]));
  parts.push(Buffer.from(EVENT_DISCRIMINATOR), Buffer.alloc(32, 7));
  i64(NOW - 100); // start
  i64(o.end ?? NOW + 86_400); // end
  i64(o.end ?? NOW + 86_400); // resolution
  i64(NOW - 1000); // created
  i64(0);
  i64(0);
  for (let i = 0; i < 4; i++) u128(BigInt(1));
  u128(o.lastYes ?? BigInt(500_085_505));
  u128(o.volume ?? BigInt(397_326_168));
  u128(BigInt(0));
  u128(BigInt(0));
  u64(BigInt(8));
  for (let i = 0; i < 5; i++) u128(BigInt(0));
  i64(0);
  u128(BigInt(0));
  str(o.question ?? "Will it rain in Mumbai tomorrow?");
  str(o.rule ?? "Resolve YES if IMD reports rain.");
  const src = o.sources ?? ["world-weather"];
  const n = Buffer.alloc(4);
  n.writeUInt32LE(src.length);
  parts.push(n);
  src.forEach(str);
  u128(o.active ?? BigInt(387_326_168));
  u8(253);
  u8(255);
  u8(254);
  u8(1); // is_active
  u8(o.graduated ? 1 : 0);
  u8(o.resolved ? 1 : 0);
  u8(o.cancelled ? 1 : 0);
  u8(0); // yes_wins
  u8(0); // whitelisted
  u8(0);
  u8(0);
  u8(0);
  i64(0); // flash_acquisition_end
  u8(0); // event_in_progress
  i64(o.ppe ?? NOW + 3600);
  parts.push(Buffer.alloc(2600)); // rest of the account (not decoded)
  return new Uint8Array(Buffer.concat(parts));
}

const ID_A = "ALio3GkarKxXy8qLdZwiUJo6XhS5QvuKw4bZKzruYdP6";
const ID_B = "69A5oC4BzV1tbd4fD8GbHkUDvL5EcTy4qeQ3xFi8Xy2P";
const ID_C = "8riUFcfpKsT5PZkmfq9xH7jNYh2M4FVt8WnB3aXqcQv9";

describe("Event account decoding", () => {
  it("discriminator is sha256('account:Event')[0..8] and its base58 is the memcmp filter", () => {
    const d = createHash("sha256").update("account:Event").digest().subarray(0, 8);
    expect([...d]).toEqual([...EVENT_DISCRIMINATOR]);
    expect(bs58.encode(Buffer.from(EVENT_DISCRIMINATOR))).toBe(EVENT_DISCRIMINATOR_B58);
  });

  it("decodes question, times, price, volume and flags", () => {
    const ev = decodeEventAccount(ID_A, eventAccount({ graduated: true }))!;
    expect(ev.question).toBe("Will it rain in Mumbai tomorrow?");
    expect(ev.resolutionRule).toBe("Resolve YES if IMD reports rain.");
    expect(ev.oracle).toBe("world-weather");
    expect(ev.endTime).toBe(NOW + 86_400);
    expect(ev.primaryPhaseEndTime).toBe(NOW + 3600);
    expect(ev.lastYesPrice).toBe("0.500085505");
    expect(ev.totalVolumeBase).toBe("397326168");
    expect(formatUsdcBase(ev.totalVolumeBase)).toBe("397.326168");
    expect(ev.isGraduated).toBe(true);
    expect(ev.isResolved).toBe(false);
  });

  it("rejects other accounts and truncated data instead of guessing", () => {
    const bad = eventAccount();
    bad[0] = 0;
    expect(decodeEventAccount(ID_A, bad)).toBeNull();
    expect(decodeEventAccount(ID_A, eventAccount().subarray(0, 420))).toBeNull();
  });
});

const row = (id: string, extra: Partial<Market> = {}): Market => ({ marketId: id, title: "", category: "sports", phase: "primary", ...extra });

describe("lifecycle", () => {
  it("classifies open / trading / closed / final", () => {
    expect(marketLifecycle({ phase: "primary", endTime: NOW + 10, primaryPhaseEndTime: NOW + 5 }, NOW)).toBe("open");
    expect(marketLifecycle({ phase: "primary", endTime: NOW + 10, primaryPhaseEndTime: NOW - 5 }, NOW)).toBe("ended");
    expect(marketLifecycle({ phase: "secondary", endTime: NOW + 10 }, NOW)).toBe("trading");
    expect(marketLifecycle({ phase: "secondary", endTime: NOW - 10 }, NOW)).toBe("ended");
    expect(marketLifecycle({ phase: "secondary", resolved: true }, NOW)).toBe("resolved");
    expect(marketLifecycle({ phase: "cancelled", endTime: NOW + 10 }, NOW)).toBe("cancelled");
    expect(marketLifecycle({ phase: "", endTime: NOW + 10 }, NOW)).toBe("unknown");
  });
});

describe("mergeCatalog", () => {
  const chain = [
    decodeEventAccount(ID_A, eventAccount({ question: "Chain-only market?" }))!,
    decodeEventAccount(ID_B, eventAccount({ question: "Listed but stale?", resolved: true, graduated: true, end: NOW - 50 }))!,
  ];

  it("adds chain-only markets and lets the account override a stale list phase", () => {
    const list = [row(ID_B, { phase: "primary", status: "open" }), row(ID_B), row(ID_C, { endTime: NOW - 99 })];
    const items = mergeCatalog(list, chain);
    expect(items.map((m) => m.marketId).sort()).toEqual([ID_A, ID_B, ID_C].sort());
    const a = items.find((m) => m.marketId === ID_A)!;
    expect(a).toMatchObject({ title: "Chain-only market?", phase: "primary", yesPrice: "0.500085505", noPrice: "0.499914495" });
    expect(a.sources).toEqual({ list: false, chain: true, detail: false });
    const b = items.find((m) => m.marketId === ID_B)!;
    expect(b).toMatchObject({ title: "Listed but stale?", phase: "resolved", resolved: true, yesPrice: null });
    expect(b.sources).toEqual({ list: true, chain: true, detail: false });
    expect(items.find((m) => m.marketId === ID_C)!.sources).toEqual({ list: true, chain: false, detail: false });
  });

  it("works without chain data (list only)", () => {
    expect(mergeCatalog([row(ID_A), row(ID_A)], null)).toHaveLength(1);
  });

  it("detail fills prices/category but keeps the on-chain lifecycle", () => {
    const [a] = mergeCatalog([], [chain[0]]);
    const detail = row(ID_A, { title: "Chain-only market?", phase: "secondary", status: "secondary", category: "weather", yesPrice: "0.61", noPrice: "0.39" });
    const merged = withDetail(a, detail);
    expect(merged).toMatchObject({ phase: "primary", category: "weather", yesPrice: "0.61" });
    expect(merged.sources?.detail).toBe(true);
  });
});

describe("sort / filter / counts", () => {
  const items: Market[] = [
    row("r1", { phase: "resolved", resolved: true, endTime: NOW - 10, totalVolumeUsdc: "9999" }),
    row("c1", { phase: "cancelled", endTime: NOW - 5 }),
    row("s1", { phase: "secondary", endTime: NOW + 50, totalVolumeUsdc: "10", category: "crypto" }),
    row("p1", { phase: "primary", endTime: NOW + 50, totalVolumeUsdc: "5" }),
    row("e1", { phase: "secondary", endTime: NOW - 1 }),
    row("r2", { phase: "resolved", resolved: true, endTime: NOW - 1 }),
  ];

  it("puts live markets first, not high-volume resolved ones", () => {
    expect(sortCatalog(items, NOW).map((m) => m.marketId)).toEqual(["p1", "s1", "e1", "r2", "r1", "c1"]);
  });

  it("filters by lifecycle, live and category", () => {
    expect(filterCatalog(items, { status: "live" }, NOW).map((m) => m.marketId).sort()).toEqual(["p1", "s1"]);
    expect(filterCatalog(items, { status: "open" }, NOW).map((m) => m.marketId)).toEqual(["p1"]);
    expect(filterCatalog(items, { status: "resolved" }, NOW)).toHaveLength(2);
    expect(filterCatalog(items, { category: "Crypto" }, NOW).map((m) => m.marketId)).toEqual(["s1"]);
  });

  it("counts every lifecycle", () => {
    expect(countLifecycles(items, NOW)).toEqual({ total: 6, live: 2, open: 1, trading: 1, unknown: 0, ended: 1, resolved: 2, cancelled: 1 });
  });
});

describe("GET /api/catalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("unions list + chain, hydrates live markets and reports exact counts", async () => {
    const future = Math.floor(Date.now() / 1000) + 86_400;
    const accounts = [
      { pubkey: ID_A, data: eventAccount({ end: future, ppe: future - 100, question: "Open chain market?" }) },
      { pubkey: ID_B, data: eventAccount({ resolved: true, graduated: true, end: future - 200_000, question: "Old one?" }) },
    ];
    const calls: string[] = [];
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        if (init?.method === "POST") {
          return json({ result: accounts.map((a) => ({ pubkey: a.pubkey, account: { data: [Buffer.from(a.data).toString("base64"), "base64"] } })) });
        }
        if (url.includes("/categories/")) return json({ categories: ["sports"] });
        if (url.includes(`/markets/${ID_A}/`)) {
          return json({ marketId: ID_A, title: "Open chain market?", category: "weather", phase: "primary", status: "primary", yesPrice: "0.52", noPrice: "0.48", endTime: future });
        }
        if (url.includes("/markets/?")) return json({ items: [{ marketId: ID_B, phase: "primary", status: "open" }, { marketId: ID_C, phase: "cancelled" }], nextCursor: "abc" });
        return json({});
      }),
    );
    const { GET } = await import("@/app/api/catalog/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts).toMatchObject({ total: 2, live: 1, open: 1, resolved: 1, cancelled: 0 });
    // ID_C is only in the list and has no mainnet account: hidden, but counted.
    expect(body.items.some((m: Market) => m.marketId === ID_C)).toBe(false);
    expect(body.sources).toMatchObject({ listUnique: 2, chainAccounts: 2, chainOnly: 1, listOnly: 1, detailHydrated: 1 });
    expect(body.items[0]).toMatchObject({ marketId: ID_A, title: "Open chain market?", yesPrice: "0.52", category: "weather" });
    // The repeated nextCursor is never followed.
    expect(calls.some((u) => u.includes("cursor="))).toBe(false);
    expect(res.headers.get("cache-control")).toContain("s-maxage");
  });
});
